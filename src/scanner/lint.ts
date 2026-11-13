import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ESLint } from "eslint";
import type { Finding } from "./findings.js";
import { isOutsideProject } from "./outside-project.js";
import { createScannerConfig } from "./scanner-config.js";

/**
 * typescript-eslint keeps one project service per process, built from the options of the first file it parses, so
 * `allowDefaultProject` of the first ESLint instance would stick to the retry. The parser's own `clearCaches`
 * (documented for tooling that lints in several passes) drops it. It is loaded through typescript-eslint, so it is
 * the copy typescript-eslint uses and not a second one; the kit has no dependency of its own on the parser.
 */
function clearTypescriptEslintCaches(): void {
    const requireFromHere = createRequire(import.meta.url);
    const requireFromTypescriptEslint = createRequire(requireFromHere.resolve("typescript-eslint"));
    const parser: unknown = requireFromTypescriptEslint("@typescript-eslint/parser");
    if (typeof parser !== "object" || parser === null || !("clearCaches" in parser) || typeof parser.clearCaches !== "function") {
        throw new Error(
            "[scan] Cannot re-lint eslint.config with types: @typescript-eslint/parser has no clearCaches(). Install the typescript-eslint version the kit pins.",
        );
    }
    Reflect.apply(parser.clearCaches, parser, []);
}

function newEslint(cwd: string, typeAware: boolean, allowDefaultProject = true): ESLint {
    return new ESLint({
        cwd,
        overrideConfigFile: true,
        baseConfig: createScannerConfig({ cwd, typeAware, allowDefaultProject }),
        warnIgnored: false,
        errorOnUnmatchedPattern: false,
    });
}

/**
 * typescript-eslint's wording for a file that the kit allows as a default project (`eslint.config.*`) and that a
 * tsconfig covers as well. It is a plugin-setup clash, not a finding: the file is linted again with the project
 * service alone. A test pins it against the installed typescript-eslint.
 */
export const DEFAULT_PROJECT_CLASH_MESSAGE = "was included by allowDefaultProject but also was found in the project service";

/** True when the file is both a default project and in a tsconfig, so it must be linted without `allowDefaultProject`. */
export function isDefaultProjectClash(result: ESLint.LintResult): boolean {
    return result.messages.some((message) => message.message.includes(DEFAULT_PROJECT_CLASH_MESSAGE));
}

/** `ESLint.LintResult[]` as findings: one per message, errors and warnings alike (both lower the score). */
export function toFindings(results: readonly ESLint.LintResult[], cwd: string): Finding[] {
    return results.flatMap((result) => {
        const file = path.relative(cwd, result.filePath).split(path.sep).join("/");
        return result.messages.map(
            (message): Finding => ({
                check: "lint",
                file,
                // ESLint leaves `line` out of a parse error, whatever its typing says.
                line: typeof message.line === "number" ? message.line : 0,
                rule: message.ruleId ?? "parse-error",
                message: message.message,
            }),
        );
    });
}

/**
 * The scanner installs a plugin's dependencies without running their install scripts, so a package that only builds
 * itself in `prepare` has no `dist/` there, and what it exports is unresolved: an `eslint.config.js` that calls
 * `obsidianPlugin()` from the kit gets `no-unsafe-call` and `no-unsafe-assignment` (the spread of the result) on the
 * live scorecard. Inferred from one plugin's 1.7.2 scorecard, where exactly those two warnings sit on the line
 * that calls the kit's helper; reproduced by deleting the kit's `dist/eslint`. It is not confirmed by the scanner's
 * authors. The module specifiers keep their line, so the findings point at the right place.
 */
const KIT_SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])obsidian-plugin-dev-kit((?:\/[^"']*)?)\2/g;

/** `text` with every import of the kit pointed at a package that does not exist. Pure. */
export function hideKitImports(text: string): string {
    return text.replace(KIT_SPECIFIER, (_match, lead: string, quote: string, subpath: string) => `${lead}${quote}obsidian-plugin-dev-kit-not-built${subpath}${quote}`);
}

const SCRIPT_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/**
 * What the two `no-unsafe-*` findings of a script that imports the kit come from, and the fix. A block
 * `eslint-disable` comment in the file is not one: it fails the plugin's own lint (unused directive,
 * `eslint-comments/disable-enable-pair`) and the scan then reports `disable-enable-pair` instead. Renaming the config
 * to `eslint.config.mjs` takes the file off the scanner's list (`**\/*.mjs` is ignored), and `obsidianPlugin()` works
 * from it.
 */
export const KIT_IMPORT_HINT =
    "The scanner installs the kit without building it, so this import is unresolved there. Name the file with the .mjs extension (eslint.config.mjs): the scanner ignores .mjs files.";

/** `results` of a script that imports the kit, with the hint added to the unresolved-import findings. */
function withKitHint(results: readonly ESLint.LintResult[]): ESLint.LintResult[] {
    return results.map((result) => ({
        ...result,
        messages: result.messages.map((message) =>
            message.ruleId === "@typescript-eslint/no-unsafe-call" || message.ruleId === "@typescript-eslint/no-unsafe-assignment" ? { ...message, message: `${message.message} ${KIT_IMPORT_HINT}` } : message,
        ),
    }));
}

/** Lints `files` (absolute paths); a script that imports the kit is linted from text where that import cannot resolve. */
async function lintFilePaths(eslint: ESLint, files: readonly string[]): Promise<ESLint.LintResult[]> {
    const importsKit = new Map<string, string>();
    for (const file of files.filter((candidate) => SCRIPT_FILE.test(candidate))) {
        const text = readFileSync(file, "utf8");
        if (hideKitImports(text) !== text) {
            importsKit.set(file, hideKitImports(text));
        }
    }
    const plain = files.filter((file) => !importsKit.has(file));
    const results = plain.length === 0 ? [] : await eslint.lintFiles(plain);
    for (const [filePath, text] of importsKit) {
        results.push(...withKitHint(await eslint.lintText(text, { filePath })));
    }
    return results;
}

/**
 * One advisory finding per file the scanner does not report: the lint findings of a file that no tsconfig covers.
 * The live scanner type-checks with the project service and reports nothing for a file outside every project (a
 * plugin's `site/assets/site.js` has 36 findings here and none on its scorecard). They stay visible as a `!` line,
 * and do not fail the scan. Inferred from that one scorecard, not confirmed by the scanner's authors.
 */
export function summariseOutsideProject(results: readonly ESLint.LintResult[], cwd: string): Finding[] {
    const byFile = new Map<string, Finding[]>();
    for (const finding of toFindings(results, cwd)) {
        byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]);
    }
    const summaries: Finding[] = [];
    for (const [file, own] of byFile) {
        const first = own[0];
        if (first !== undefined) {
            summaries.push({
                check: "lint",
                file,
                line: first.line,
                rule: "outside-tsconfig",
                message: `${String(own.length)} lint finding${own.length === 1 ? "" : "s"} in a file no tsconfig covers (first: ${first.rule}). The scorecard compared did not list files outside every tsconfig project (inferred from one scorecard), and would if a tsconfig covered this one.`,
                advisory: true,
            });
        }
    }
    return summaries;
}

export interface LintOutcome {
    readonly findings: Finding[];
    /** Files linted at all (ignored ones excluded). */
    readonly linted: number;
    /** Files no tsconfig covers: their findings are advisory, the scanner does not report them. */
    readonly untyped: number;
}

/**
 * The scanner's ESLint pass over `files` (paths relative to `cwd`), with its own configuration. Files no tsconfig
 * covers are linted again without type information instead of failing to parse, but only as advisory lines (the
 * live scanner does not report them), and an `eslint.config.*` that a tsconfig covers is linted again with types and
 * without `allowDefaultProject`.
 */
export async function runScannerLint(cwd: string, files: readonly string[]): Promise<LintOutcome> {
    const typed = await lintFilePaths(newEslint(cwd, true), files.map((file) => path.join(cwd, file)));
    const outside = typed.filter(isOutsideProject);
    const clashing = typed.filter(isDefaultProjectClash);
    const untypedResults = outside.length === 0 ? [] : await lintFilePaths(newEslint(cwd, false), outside.map((result) => result.filePath));
    let retypedResults: ESLint.LintResult[] = [];
    if (clashing.length > 0) {
        clearTypescriptEslintCaches();
        try {
            retypedResults = await lintFilePaths(newEslint(cwd, true, false), clashing.map((result) => result.filePath));
        } finally {
            // The service built for this pass has no default project; later passes in this process start fresh.
            clearTypescriptEslintCaches();
        }
    }
    const reported = [...typed.filter((result) => !isOutsideProject(result) && !isDefaultProjectClash(result)), ...retypedResults];
    return {
        findings: [...toFindings(reported, cwd), ...summariseOutsideProject(untypedResults, cwd)],
        linted: reported.length + untypedResults.length,
        untyped: untypedResults.length,
    };
}

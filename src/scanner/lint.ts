import { createRequire } from "node:module";
import path from "node:path";
import { ESLint } from "eslint";
import type { Finding } from "./findings.js";
import { createScannerConfig } from "./scanner-config.js";

/**
 * typescript-eslint's wording for a file no tsconfig covers. The scanner lints such a file without type
 * information instead of failing, so the retry in `runScannerLint` is keyed on this message; a test pins it
 * against the installed typescript-eslint.
 */
export const PROJECT_SERVICE_MESSAGE = "was not found by the project service";

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
 * TypeScript's TS18003: the tsconfig's `include` matches no file at all. On Linux the project service
 * reports this instead of `PROJECT_SERVICE_MESSAGE` for a file next to such a tsconfig (seen on GitHub
 * Actions, not on macOS), and the file is just as much outside every project.
 */
export const NO_INPUTS_MESSAGE = "No inputs were found in config file";

/** True when typescript-eslint could not place the file in any tsconfig project, so it must be linted without types. */
export function isOutsideProject(result: ESLint.LintResult): boolean {
    return result.messages.some(
        (message) => message.message.includes(PROJECT_SERVICE_MESSAGE) || message.message.includes(NO_INPUTS_MESSAGE),
    );
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

export interface LintOutcome {
    readonly findings: Finding[];
    /** Files linted at all (ignored ones excluded). */
    readonly linted: number;
    /** Files no tsconfig covers, linted without type information. */
    readonly untyped: number;
}

/**
 * The scanner's ESLint pass over `files` (paths relative to `cwd`), with its own configuration. Files no tsconfig
 * covers are linted again without type information, as the scanner does, instead of failing to parse, and an
 * `eslint.config.*` that a tsconfig covers is linted again with types and without `allowDefaultProject`.
 */
export async function runScannerLint(cwd: string, files: readonly string[]): Promise<LintOutcome> {
    const typed = await newEslint(cwd, true).lintFiles([...files]);
    const outside = typed.filter(isOutsideProject);
    const clashing = typed.filter(isDefaultProjectClash);
    const untypedResults = outside.length === 0 ? [] : await newEslint(cwd, false).lintFiles(outside.map((result) => result.filePath));
    let retypedResults: ESLint.LintResult[] = [];
    if (clashing.length > 0) {
        clearTypescriptEslintCaches();
        try {
            retypedResults = await newEslint(cwd, true, false).lintFiles(clashing.map((result) => result.filePath));
        } finally {
            // The service built for this pass has no default project; later passes in this process start fresh.
            clearTypescriptEslintCaches();
        }
    }
    const results = [
        ...typed.filter((result) => !isOutsideProject(result) && !isDefaultProjectClash(result)),
        ...untypedResults,
        ...retypedResults,
    ];
    return { findings: toFindings(results, cwd), linted: results.length, untyped: untypedResults.length };
}

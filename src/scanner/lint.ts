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

function newEslint(cwd: string, typeAware: boolean): ESLint {
    return new ESLint({
        cwd,
        overrideConfigFile: true,
        baseConfig: createScannerConfig({ cwd, typeAware }),
        warnIgnored: false,
        errorOnUnmatchedPattern: false,
    });
}

function isOutsideProject(result: ESLint.LintResult): boolean {
    return result.messages.some((message) => message.message.includes(PROJECT_SERVICE_MESSAGE));
}

/** `ESLint.LintResult[]` as findings: one per message, errors and warnings alike (both lower the score). */
export function toFindings(results: readonly ESLint.LintResult[], cwd: string): Finding[] {
    return results.flatMap((result) => {
        const file = path.relative(cwd, result.filePath).split(path.sep).join("/");
        return result.messages.map(
            (message): Finding => ({
                check: "lint",
                file,
                line: message.line,
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
 * covers are linted again without type information, as the scanner does, instead of failing to parse.
 */
export async function runScannerLint(cwd: string, files: readonly string[]): Promise<LintOutcome> {
    const typed = await newEslint(cwd, true).lintFiles([...files]);
    const outside = typed.filter(isOutsideProject);
    const untypedResults = outside.length === 0 ? [] : await newEslint(cwd, false).lintFiles(outside.map((result) => result.filePath));
    const results = [...typed.filter((result) => !isOutsideProject(result)), ...untypedResults];
    return { findings: toFindings(results, cwd), linted: results.length, untyped: untypedResults.length };
}

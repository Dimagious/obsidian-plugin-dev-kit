import type { Finding } from "./findings.js";

/** A file the checks read: its path relative to the plugin root (`/` separators) and its text. */
export interface SourceFile {
    readonly path: string;
    readonly text: string;
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/;
// Tests, mocks and fakes never reach the bundle. A `preview/` folder is not on this list on purpose: the scanner
// reads it (eslint-plugin-obsidianmd 0.5.1 found seven warnings on one plugin's preview stand that the old gate skipped).
const UNSHIPPED_PATH = /(?:^|\/)(?:test|tests|__tests__|__mocks__|node_modules)\/|\.(?:test|spec)\.[^/]+$/;

/** Whether a tracked file is plugin source for the `code` check: script files under `src/`, tests aside. */
export function isShippedSource(relativePath: string): boolean {
    return relativePath.startsWith("src/") && SOURCE_EXTENSION.test(relativePath) && !UNSHIPPED_PATH.test(relativePath);
}

/**
 * Blanks out comments so prose cannot trip a rule, keeping every newline so the
 * line numbers still point at the right place.
 *
 * Per-line stripping was the previous approach and it could not see a JSDoc
 * block: the inner lines carry neither `//` nor a complete block-comment pair, so
 * a sentence ending in "leaves the document." counted as a violation.
 *
 * It is textual, not a parser: a `//` or a slash-star inside a string literal (a URL, a glob) starts a "comment"
 * that blanks the rest of the line, or up to the next star-slash. The checks below can therefore miss a hit
 * after such a literal; they never invent one.
 */
export function stripComments(text: string): string {
    const blank = (match: string): string => match.replace(/[^\n]/g, " ");
    return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

const JOIN_DOT = /\[\s*["'][^"']+["'][\s\S]*?\]\s*\.\s*join\s*\(\s*["']\.["']\s*\)/;
const JOIN_SLASH = /\[\s*["'][^"']+["'][\s\S]*?\]\s*\.\s*join\s*\(\s*["']\/["']\s*\)/;
const TS_DIRECTIVE = /(?:\/\/|\/\*+)\s*@ts-(?:expect-error|ignore|nocheck)\b/;

/**
 * Scorecard warning: "Plugin assembles domain names at runtime from split/joined parts."
 *
 * Triggered by patterns like `["forum", "obsidian", "md"].join(".")`: anything that reconstructs a URL host from
 * string fragments. Flags `.join(".")` and `.join("/")` on an inline array literal of strings.
 *
 * False-positive risk: someone could use `.join(".")` on a legitimate non-URL list. The fix in that case is a
 * different separator, or a name that makes the non-URL intent obvious. The check is line-based, so an array that
 * spans lines is not seen.
 */
export function checkDomainAssembly(file: SourceFile): Finding[] {
    const findings: Finding[] = [];
    stripComments(file.text)
        .split("\n")
        .forEach((line, index) => {
            if (JOIN_DOT.test(line) || JOIN_SLASH.test(line)) {
                findings.push({
                    check: "code",
                    file: file.path,
                    line: index + 1,
                    rule: "no-domain-assembly",
                    message: "Domain or URL assembled from array.join(): the scorecard flags it as evasion. Use a string literal.",
                });
            }
        });
    return findings;
}

/**
 * `@ts-expect-error`, `@ts-ignore` and `@ts-nocheck` against Obsidian's API: prefer augmenting its types in the
 * plugin. Advisory: the scanner's ESLint configuration leaves `ban-ts-comment` off, and nothing found shows the
 * scorecard counts these, so they are printed but do not fail the scan. Reads the raw text, because the
 * directives are comments.
 */
export function checkTsSuppressions(file: SourceFile): Finding[] {
    const findings: Finding[] = [];
    file.text.split("\n").forEach((line, index) => {
        if (TS_DIRECTIVE.test(line)) {
            findings.push({
                check: "code",
                file: file.path,
                line: index + 1,
                rule: "ts-suppression",
                message: "TypeScript suppression directive: prefer augmenting Obsidian's types in the plugin.",
                advisory: true,
            });
        }
    });
    return findings;
}

/** Both checks over every shipped source file. */
export function checkCode(files: readonly SourceFile[]): Finding[] {
    return files
        .filter((file) => isShippedSource(file.path))
        .flatMap((file) => [...checkDomainAssembly(file), ...checkTsSuppressions(file)]);
}

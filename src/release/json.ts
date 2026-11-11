import { readFileSync } from "node:fs";

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

/** A file as the release module reads it: its text and parsed value, or why there is neither. */
export type Loaded =
    | { readonly kind: "ok"; readonly text: string; readonly value: unknown }
    | { readonly kind: "missing" }
    | { readonly kind: "invalid"; readonly message: string };

export function loadJson(file: string): Loaded {
    let text: string;
    try {
        text = readFileSync(file, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return { kind: "missing" };
        }
        throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    try {
        return { kind: "ok", text, value: JSON.parse(text) };
    } catch (error) {
        return { kind: "invalid", message: error instanceof Error ? error.message : String(error) };
    }
}

/** The text of a file, or undefined when it does not exist. Other read errors throw. */
export function loadText(file: string): string | undefined {
    try {
        return readFileSync(file, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return undefined;
        }
        throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
}

/** The layout `stringifyLike` keeps: line endings, indentation and final newline of the original text. */
interface Layout {
    readonly crlf: boolean;
    /** The text with CRLF read as LF. */
    readonly text: string;
    readonly indent: string | number;
    readonly write: (value: unknown) => string;
}

function layoutOf(originalText: string): Layout {
    // A file whose every line ends in CRLF is compared and written as LF, then converted back; a file that mixes the two is refused.
    const crlf = originalText.includes("\r\n") && !originalText.replace(/\r\n/g, "").includes("\n");
    const text = crlf ? originalText.replace(/\r\n/g, "\n") : originalText;
    const indent = detectIndent(text);
    const finalNewline = text.endsWith("\n") ? "\n" : "";
    return { crlf, text, indent, write: (value) => `${JSON.stringify(value, null, indent)}${finalNewline}` };
}

/** What is wrong with a file's formatting and what to do about it. */
export interface FormatIssue {
    readonly message: string;
    readonly hint: string;
}

/**
 * Whether `JSON.stringify` would write the file back unchanged. Returns undefined when it would, else what to tell
 * the owner. Prettier is no fix: it keeps `{"1.7.1": "1.5.0"}` on one line, so the hint rewrites the file with the
 * same `JSON.stringify` call (and the file's own indent) that opdk uses.
 */
export function findFormatIssue(originalText: string, parsed: unknown, fileName: string): FormatIssue | undefined {
    const layout = layoutOf(originalText);
    if (layout.write(parsed) === layout.text) {
        return undefined;
    }
    const indent = typeof layout.indent === "number" ? String(layout.indent) : "'\\t'";
    const script = `const fs = require('fs'); const f = '${fileName}'; fs.writeFileSync(f, JSON.stringify(JSON.parse(fs.readFileSync(f, 'utf8')), null, ${indent}) + '\\n')`;
    return {
        message: `${fileName} is not formatted the way JSON.stringify writes it (indent, line endings or spacing), so opdk would reformat the whole file.`,
        hint: `Rewrite it once with \`node -e "${script}"\` and run opdk again.`,
    };
}

/**
 * Rewrites a JSON file's text from a changed value, keeping its indentation, final newline and line endings (all
 * CRLF or all LF). It refuses a file that `JSON.stringify` would not write back unchanged (mixed line endings,
 * hand-aligned values): reformatting the whole file in a release commit hides the one line that matters.
 */
export function stringifyLike(originalText: string, parsed: unknown, changed: unknown, fileName: string): string {
    const issue = findFormatIssue(originalText, parsed, fileName);
    if (issue !== undefined) {
        throw new Error(`${issue.message} ${issue.hint}`);
    }
    const layout = layoutOf(originalText);
    const result = layout.write(changed);
    return layout.crlf ? result.replace(/\n/g, "\r\n") : result;
}

function detectIndent(text: string): string | number {
    const match = /^([ \t]+)\S/m.exec(text);
    const indent = match?.[1];
    if (indent === undefined) {
        return 2;
    }
    return indent.includes("\t") ? "\t" : indent.length;
}

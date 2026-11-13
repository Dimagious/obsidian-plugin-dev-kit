import path from "node:path";

const IMPORT_PATTERN = /@import\s+['"]([^'"]+)['"];?/g;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export interface InlineResult {
    readonly css: string;
    /** Every file read, entry first. A file imported twice is listed twice. */
    readonly files: readonly string[];
}

/**
 * An import problem (missing file, cycle). `files` are the ones read before it, so `--watch` can poll them.
 * `missing` is the absolute path that was not found, so `--watch` can poll it too: creating it must trigger a sync.
 */
export class CssImportError extends Error {
    constructor(
        message: string,
        readonly files: readonly string[],
        readonly missing?: string,
    ) {
        super(message);
        this.name = "CssImportError";
    }
}

/**
 * Inlines `@import "x.css"` directives, recursively, each path relative to the file that imports it.
 * Pure: file contents come from `read`, which returns undefined for a missing file.
 *
 * Two deliberate differences from the plugin script this was ported from: a missing import is an error
 * that names the importing file (that script printed a warning and left the `@import` in), and an import
 * cycle is an error (that script overflowed the stack). Imports of URLs are left in place for the browser.
 */
export function inlineImports(entryFile: string, read: (file: string) => string | undefined): InlineResult {
    const files: string[] = [];
    const inline = (file: string, chain: readonly string[]): string => {
        const css = read(file);
        if (css === undefined) {
            throw new CssImportError(`CSS file not found: ${file}.`, [...files], file);
        }
        files.push(file);
        const here = [...chain, file];
        return css.replace(IMPORT_PATTERN, (match, importPath: string) => {
            if (URL_PATTERN.test(importPath)) {
                return match;
            }
            const target = path.resolve(path.dirname(file), importPath);
            if (here.includes(target)) {
                throw new CssImportError(
                    `CSS import cycle: ${[...here, target].join(" -> ")}. Remove one of the @import lines to break it.`,
                    [...files],
                );
            }
            if (read(target) === undefined) {
                throw new CssImportError(
                    `${file}: @import "${importPath}" not found (looked for ${target}). Fix the path or remove the import.`,
                    [...files],
                    target,
                );
            }
            return inline(target, here);
        });
    };
    return { css: inline(path.resolve(entryFile), []), files };
}

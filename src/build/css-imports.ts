import path from "node:path";

const IMPORT_PATTERN = /@import\s+['"]([^'"]+)['"];?/g;
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export interface InlineResult {
    readonly css: string;
    /** Every file read, entry first. A file imported twice is listed twice. */
    readonly files: readonly string[];
}

/**
 * Inlines `@import "x.css"` directives, recursively, each path relative to the file that imports it.
 * Pure: file contents come from `read`, which returns undefined for a missing file.
 *
 * Two deliberate differences from the Dashy script this was ported from: a missing import is an error
 * that names the importing file (Dashy printed a warning and left the `@import` in), and an import
 * cycle is an error (Dashy overflowed the stack). Imports of URLs are left in place for the browser.
 */
export function inlineImports(entryFile: string, read: (file: string) => string | undefined): InlineResult {
    const files: string[] = [];
    const inline = (file: string, chain: readonly string[]): string => {
        const css = read(file);
        if (css === undefined) {
            throw new Error(`CSS file not found: ${file}.`);
        }
        files.push(file);
        const here = [...chain, file];
        return css.replace(IMPORT_PATTERN, (match, importPath: string) => {
            if (URL_PATTERN.test(importPath)) {
                return match;
            }
            const target = path.resolve(path.dirname(file), importPath);
            if (here.includes(target)) {
                throw new Error(
                    `CSS import cycle: ${[...here, target].join(" -> ")}. Remove one of the @import lines to break it.`,
                );
            }
            if (read(target) === undefined) {
                throw new Error(
                    `${file}: @import "${importPath}" not found (looked for ${target}). Fix the path or remove the import.`,
                );
            }
            return inline(target, here);
        });
    };
    return { css: inline(path.resolve(entryFile), []), files };
}

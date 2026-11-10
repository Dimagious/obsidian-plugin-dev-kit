import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inlineImports } from "./css-imports.js";
import type { ResolvedCss } from "./options.js";

export type CssResult =
    | {
          readonly status: "built";
          readonly files: number;
          readonly lines: number;
          /** Absolute paths of the distinct files that were read, entry first. `--watch` polls exactly these. */
          readonly inputs: readonly string[];
      }
    /** The entry file does not exist: the plugin keeps a hand-written stylesheet. */
    | { readonly status: "no-entry" };

/** Bundles `css.entry` into `css.outfile` (both relative to cwd). */
export function buildCss(cwd: string, css: ResolvedCss): CssResult {
    const entry = path.resolve(cwd, css.entry);
    if (!existsSync(entry)) {
        return { status: "no-entry" };
    }
    const result = inlineImports(entry, (file) => (existsSync(file) ? readFileSync(file, "utf8") : undefined));
    const outfile = path.resolve(cwd, css.outfile);
    mkdirSync(path.dirname(outfile), { recursive: true });
    writeFileSync(outfile, result.css);
    return {
        status: "built",
        files: result.files.length,
        lines: result.css.split("\n").length,
        inputs: [...new Set(result.files)],
    };
}

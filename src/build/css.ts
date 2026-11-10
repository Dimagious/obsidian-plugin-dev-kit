import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

/**
 * A cheap fingerprint of a file as the filesystem reports it (mtime and size), or undefined when it does not exist.
 * `--watch` compares the stamp taken when a file was read with a later one to see an edit that `fs.watchFile`
 * missed, see `runVaultBuild`.
 */
export function fileStamp(file: string): string | undefined {
    try {
        const stats = statSync(file);
        return `${String(stats.mtimeMs)}:${String(stats.size)}`;
    } catch (error) {
        if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
            return undefined;
        }
        throw error;
    }
}

/**
 * Bundles `css.entry` into `css.outfile` (both relative to cwd).
 * `onRead` is called for every file the bundler looks up, with its stamp taken just before the read
 * (undefined for a missing file), also for the lookups of a run that then fails.
 */
export function buildCss(
    cwd: string,
    css: ResolvedCss,
    onRead?: (file: string, stamp: string | undefined) => void,
): CssResult {
    const entry = path.resolve(cwd, css.entry);
    if (!existsSync(entry)) {
        return { status: "no-entry" };
    }
    const result = inlineImports(entry, (file) => {
        // Stamp first: an edit between the stamp and the read then looks newer than the stamp, which costs one
        // extra sync, never a lost edit.
        const stamp = fileStamp(file);
        onRead?.(file, stamp);
        return stamp === undefined ? undefined : readFileSync(file, "utf8");
    });
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

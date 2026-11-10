import { existsSync } from "node:fs";
import path from "node:path";
import type { CommandContext } from "../cli/types.js";
import { buildCss, type CssResult } from "./css.js";
import type { ResolvedCss } from "./options.js";

/**
 * Runs the CSS bundler and logs what happened. Errors (missing import, cycle) propagate.
 * Without a CSS entry a hand-written stylesheet is a normal setup (`·`); with no stylesheet at all the plugin
 * ships none, which is worth a `!`. `announceNoEntry: false` stays quiet about both, so `--watch` says it once.
 */
export function runCssStep(
    cwd: string,
    css: ResolvedCss,
    out: Pick<CommandContext, "reporter">,
    announceNoEntry = true,
): CssResult {
    const result = buildCss(cwd, css);
    if (result.status === "no-entry") {
        if (announceNoEntry) {
            if (existsSync(path.resolve(cwd, css.outfile))) {
                out.reporter.info("css", `no ${css.entry}, keeping ${css.outfile} as is`);
            } else {
                out.reporter.warn("css", `no ${css.entry} and no ${css.outfile}, the plugin ships no stylesheet`);
            }
        }
        return result;
    }
    const files = `${String(result.files)} ${result.files === 1 ? "file" : "files"}`;
    const lines = `${String(result.lines)} ${result.lines === 1 ? "line" : "lines"}`;
    out.reporter.success("css", `${css.entry} -> ${css.outfile} (${files}, ${lines})`);
    return result;
}

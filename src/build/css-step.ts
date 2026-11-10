import type { CommandContext } from "../cli/types.js";
import { buildCss, type CssResult } from "./css.js";
import type { ResolvedCss } from "./options.js";

/** Runs the CSS bundler and logs what happened. Errors (missing import, cycle) propagate. */
export function runCssStep(cwd: string, css: ResolvedCss, out: Pick<CommandContext, "reporter">): CssResult {
    const result = buildCss(cwd, css);
    if (result.status === "no-entry") {
        out.reporter.warn("css", `no ${css.entry}, keeping ${css.outfile} as is`);
        return result;
    }
    const files = `${String(result.files)} ${result.files === 1 ? "file" : "files"}`;
    const lines = `${String(result.lines)} ${result.lines === 1 ? "line" : "lines"}`;
    out.reporter.success("css", `${css.entry} -> ${css.outfile} (${files}, ${lines})`);
    return result;
}

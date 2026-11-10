import { statSync } from "node:fs";
import path from "node:path";
import { build as esbuildBuild } from "esbuild";
import type { CommandContext } from "../cli/types.js";
import type { Manifest } from "../config/types.js";
import { checkBundleFile } from "./bundle-file.js";
import { runCssStep } from "./css-step.js";
import { toEsbuildOptions, type ResolvedBuild } from "./options.js";
import { formatKb, isBuildFailure, printMessages } from "./report.js";

/** `opdk build`: CSS, then the bundle, then the Node-only check. Returns the exit code. */
export async function runReleaseBuild(manifest: Manifest, build: ResolvedBuild, ctx: CommandContext): Promise<number> {
    const id = manifest.id;
    if (build.css !== false) {
        runCssStep(ctx.cwd, build.css, ctx);
    }
    ctx.reporter.info("build", `${id}: bundling ${build.entry}`);

    const options = toEsbuildOptions(build, ctx.cwd, { kind: "release" });
    try {
        const result = await esbuildBuild(options);
        await printMessages(result.warnings, "warning", ctx);
    } catch (error) {
        if (!isBuildFailure(error)) {
            throw error;
        }
        await printMessages(error.warnings, "warning", ctx);
        await printMessages(error.errors, "error", ctx);
        ctx.reporter.failure("build", `${id}: build failed with ${String(error.errors.length)} error(s).`, {
            hint: "Fix them and rerun `opdk build`.",
        });
        return 1;
    }

    const outfile = path.resolve(ctx.cwd, build.outfile);
    ctx.reporter.success("build", `${id}: ${build.outfile} ${formatKb(statSync(outfile).size)}`);
    return checkBundleFile(outfile, manifest, ctx);
}

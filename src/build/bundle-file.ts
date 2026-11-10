import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CommandContext } from "../cli/types.js";
import type { Manifest } from "../config/types.js";
import { findNodeOnlyReferences } from "./bundle-check.js";
import { formatKb } from "./report.js";

/** Runs the Node-only check on a built file and prints the result. Returns the exit code. */
export function checkBundleFile(file: string, manifest: Manifest, ctx: CommandContext): number {
    const relative = path.relative(ctx.cwd, file);
    // A file outside the plugin would print as ../../x; the absolute path says more.
    const name = relative === "" || relative.startsWith("..") ? file : relative;
    if (manifest.isDesktopOnly === true) {
        ctx.reporter.info("bundle", `${manifest.id} is desktop only and Node is available there: skipping the check of ${name}`);
        return 0;
    }
    if (!existsSync(file)) {
        ctx.reporter.failure("bundle", `${name} is missing: run \`opdk build\` first`);
        return 1;
    }
    const code = readFileSync(file, "utf8");
    const problems = findNodeOnlyReferences(code);
    if (problems.length > 0) {
        ctx.reporter.failure("bundle", `${name} cannot run on mobile:`, {
            details: problems.map((problem) => `- ${problem}`),
            hint: "Check the esbuild platform: an Obsidian plugin bundles as `browser`.",
        });
        return 1;
    }
    ctx.reporter.success("bundle", `${name} is free of Node-only references (${formatKb(Buffer.byteLength(code))})`);
    return 0;
}

import path from "node:path";
import type { Command } from "../cli/types.js";
import { loadConfig } from "../config/load-config.js";
import { readManifest } from "../config/manifest.js";
import { parseBuildArgs } from "./args.js";
import { checkBundleFile } from "./bundle-file.js";
import { runCssStep } from "./css-step.js";
import { resolveBuild, resolveVaultDir } from "./options.js";
import { runReleaseBuild } from "./release.js";
import { runVaultBuild } from "./vault.js";

const buildUsage = `Usage: opdk build [--vault [dir] | --vault=<dir>] [--watch] [--force]

Builds the CSS, bundles the plugin with esbuild for the browser platform (so it
runs on phones), then checks main.js for Node-only code.

Options:
  --vault [dir]  Build into a dev vault: unminified main.js in <dir>, plus a fresh
                 styles.css and manifest.json. <dir> defaults to $VAULT_PLUGIN
                 (also written --vault=<dir>). No bundle check in this mode.
                 Refuses a <dir> whose manifest.json holds another plugin id.
  --force        With --vault: overwrite <dir> even if it holds another plugin.
  --watch        With --vault: rebuild on changes to the sources, the CSS and
                 manifest.json. Stop with Ctrl+C. Restart it after editing opdk.config.mjs.

Settings come from opdk.config.mjs ("build" section); the plugin id from manifest.json.
`;

const cssUsage = `Usage: opdk build-css

Inlines the @import lines of the CSS entry (default src/styles/main.css) into
styles.css. Imports resolve relative to the file that contains them. A missing
import or an import cycle is an error, and so is a missing entry (exit 1).
`;

const assertUsage = `Usage: opdk assert-bundle [file]

Fails if the built bundle (default: the build outfile, main.js) contains code that
exists only under Node (process, node: imports, __dirname, the Node build of a
dependency), because it would break on mobile. Skipped for desktop-only plugins.
`;

export const buildCommand: Command = {
    name: "build",
    summary: "Build CSS, bundle the plugin for the browser platform, check the bundle",
    usage: buildUsage,
    async run(args, ctx) {
        const parsed = parseBuildArgs(args);
        const manifest = readManifest(ctx.cwd);
        const config = await loadConfig(ctx.cwd);
        const build = resolveBuild(config.build);
        if (!parsed.vault) {
            return runReleaseBuild(manifest, build, ctx);
        }
        const { dir, source } = resolveVaultDir(parsed.vaultDir, ctx.env, manifest.id);
        ctx.reporter.info("build", `${manifest.id}: vault target ${dir} (from ${source === "flag" ? "--vault" : "VAULT_PLUGIN"})`);
        const controller = new AbortController();
        const stopListening = parsed.watch ? ctx.onInterrupt?.(() => {
                  controller.abort();
              }) : undefined;
        try {
            return await runVaultBuild({
                cwd: ctx.cwd,
                manifest,
                build,
                dir,
                watch: parsed.watch,
                force: parsed.force,
                reporter: ctx.reporter,
                signal: controller.signal,
            });
        } finally {
            stopListening?.();
        }
    },
};

export const buildCssCommand: Command = {
    name: "build-css",
    summary: "Inline the @import lines of the CSS entry into styles.css",
    usage: cssUsage,
    async run(args, ctx) {
        if (args.length > 0) {
            throw new Error(`"opdk build-css" takes no arguments, got "${args.join(" ")}".`);
        }
        const config = await loadConfig(ctx.cwd);
        const { css } = resolveBuild(config.build);
        if (css === false) {
            ctx.reporter.info("css", 'disabled by "build.css: false" in opdk.config.mjs, nothing to do');
            return 0;
        }
        // The failure below says it all, so the step stays quiet about the missing entry.
        if (runCssStep(ctx.cwd, css, ctx, false).status === "no-entry") {
            ctx.reporter.failure("css", `nothing was built. Create ${css.entry}, or set "build.css.entry" in opdk.config.mjs.`);
            return 1;
        }
        return 0;
    },
};

export const assertBundleCommand: Command = {
    name: "assert-bundle",
    summary: "Fail if the built bundle contains Node-only code",
    usage: assertUsage,
    async run(args, ctx) {
        if (args.length > 1 || args[0]?.startsWith("-") === true) {
            throw new Error(`Usage: opdk assert-bundle [file]. Got: ${args.join(" ")}`);
        }
        const manifest = readManifest(ctx.cwd);
        const config = await loadConfig(ctx.cwd);
        const file = path.resolve(ctx.cwd, args[0] ?? resolveBuild(config.build).outfile);
        return checkBundleFile(file, manifest, ctx);
    },
};

export const buildCommands: readonly Command[] = [buildCommand, buildCssCommand, assertBundleCommand];

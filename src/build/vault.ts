import { copyFileSync, existsSync, mkdirSync, readFileSync, unwatchFile, watchFile, type Stats } from "node:fs";
import path from "node:path";
import { context } from "esbuild";
import type { Reporter } from "../cli/reporter.js";
import type { Manifest } from "../config/types.js";
import { CssImportError } from "./css-imports.js";
import { runCssStep } from "./css-step.js";
import { toEsbuildOptions, type ResolvedBuild } from "./options.js";
import { isBuildFailure, printMessages } from "./report.js";

export interface VaultBuildOptions {
    readonly cwd: string;
    readonly manifest: Manifest;
    readonly build: ResolvedBuild;
    /** The plugin folder inside the dev vault. */
    readonly dir: string;
    readonly watch: boolean;
    /** Write into a folder that holds another plugin. Off by default, see `checkVaultTarget`. */
    readonly force?: boolean;
    readonly reporter: Reporter;
    /** Required in watch mode: the build runs until this aborts (SIGINT in the CLI). */
    readonly signal?: AbortSignal;
    /** Called after every asset sync (CSS rebuild and copy). Lets tests await a rebuild without sleeping. */
    readonly onAssetsSynced?: () => void;
}

const POLL_INTERVAL_MS = 300;

/** `opdk build --vault`: unminified bundle plus styles.css and manifest.json in the dev vault. Returns the exit code. */
export async function runVaultBuild(options: VaultBuildOptions): Promise<number> {
    const { cwd, manifest, build, watch: watching } = options;
    const id = manifest.id;
    const vaultDir = path.resolve(cwd, options.dir);
    // The stylesheet the vault gets: the bundled one, or the hand-written styles.css of a plugin without src/styles.
    const stylesSource = path.resolve(cwd, build.css === false ? "styles.css" : build.css.outfile);
    const state = { assetsFailed: false, hookFailed: false, watching: false };
    // The CSS files the last successful CSS step read; polled in watch mode so a new or removed import is tracked.
    const cssEntry = build.css === false ? undefined : path.resolve(cwd, build.css.entry);
    let cssInputs: readonly string[] = [];
    // The import target the last failed CSS step could not find. Polled too, so creating it triggers a sync.
    let cssMissing: string | undefined;
    const polled = new Set<string>();

    const rejection = checkVaultDirArgument(options.dir, vaultDir, cwd);
    if (rejection !== undefined) {
        options.reporter.failure("build", `${id}: ${rejection}`);
        return 1;
    }
    if (options.force !== true) {
        const message = checkVaultTarget(vaultDir, id);
        if (message !== undefined) {
            options.reporter.failure("build", `${id}: ${message}`);
            return 1;
        }
    }
    if (watching && options.signal === undefined) {
        throw new Error("runVaultBuild: watch mode needs an AbortSignal to know when to stop.");
    }

    const syncAssets = (): void => {
        state.assetsFailed = false;
        try {
            // Rebuild the stylesheet rather than copying whatever is lying around.
            // Copying it stale is silent and shipped a vault missing the styles of two
            // whole blocks: the TypeScript was fresh, the CSS was three commits old.
            if (build.css !== false) {
                const result = runCssStep(cwd, build.css, options);
                if (result.status === "built") {
                    cssInputs = result.inputs;
                    cssMissing = undefined;
                }
            }
            mkdirSync(vaultDir, { recursive: true });
            if (existsSync(stylesSource)) {
                copyFileSync(stylesSource, path.join(vaultDir, "styles.css"));
            }
            copyFileSync(path.join(cwd, "manifest.json"), path.join(vaultDir, "manifest.json"));
            options.reporter.success("build", `${id}: assets copied to ${vaultDir}`);
        } catch (error) {
            state.assetsFailed = true;
            if (error instanceof CssImportError) {
                // Poll what the step read before it failed, or fixing a broken nested file would never trigger a sync.
                // Keep the previous inputs too: a file that was polled stays polled while a step fails.
                cssInputs = [...new Set([...cssInputs, ...error.files])];
                cssMissing = error.missing;
            }
            options.reporter.failure("build", `${id}: CSS build or copy failed: ${errorMessage(error)}`);
        }
        if (state.watching) {
            pollCssFiles();
        }
        options.onAssetsSynced?.();
    };

    // fs.watchFile on a missing path calls the listener once, immediately, with zeroed stats for both curr and prev.
    // That is not a change: syncing on it would run the CSS step again and print the same import error twice.
    const onCssPoll = (curr: Stats, prev: Stats): void => {
        if (curr.mtimeMs === 0 && prev.mtimeMs === 0) {
            return;
        }
        syncAssets();
    };

    // Poll the exact files the CSS step reads. A recursive fs.watch on the folder delivered nothing for 4-6 s
    // on macOS (FSEvents latency), and an outfile inside that folder would have retriggered it forever.
    // The entry stays polled even when the last CSS step failed, so fixing it triggers the next sync.
    const pollCssFiles = (): void => {
        const wanted = new Set(cssInputs);
        if (cssMissing !== undefined) {
            wanted.add(cssMissing);
        }
        if (cssEntry !== undefined && existsSync(cssEntry)) {
            wanted.add(cssEntry);
        }
        for (const file of wanted) {
            if (!polled.has(file)) {
                polled.add(file);
                watchFile(file, { interval: POLL_INTERVAL_MS }, onCssPoll);
            }
        }
        for (const file of polled) {
            if (!wanted.has(file)) {
                polled.delete(file);
                unwatchFile(file, onCssPoll);
            }
        }
    };

    // ctx.watch() resolves before its first build reaches onEnd; the Watching line waits for that build.
    let firstBuildDone: () => void = () => undefined;
    const firstBuild = new Promise<void>((resolve) => {
        firstBuildDone = resolve;
    });

    const ctx = await context({
        ...toEsbuildOptions(build, cwd, { kind: "vault", dir: vaultDir }),
        plugins: [
            {
                name: "opdk-vault",
                setup(esbuild) {
                    esbuild.onEnd(async (result) => {
                        try {
                            await printMessages(result.warnings, "warning", options);
                            await printMessages(result.errors, "error", options);
                            if (result.errors.length === 0) {
                                options.reporter.success("build", `${id}: built ${path.join(vaultDir, "main.js")}`);
                            } else {
                                options.reporter.failure("build", `${id}: build had ${String(result.errors.length)} error(s)`);
                            }
                            syncAssets();
                        } catch (error) {
                            // A throw inside an esbuild hook would surface as a bare esbuild error; say what failed.
                            state.hookFailed = true;
                            options.reporter.failure("build", `${id}: reporting the build failed: ${errorMessage(error)}`);
                        } finally {
                            firstBuildDone();
                        }
                    });
                },
            },
        ],
    });

    if (!watching) {
        let buildFailed = false;
        try {
            await ctx.rebuild();
        } catch (error) {
            if (!isBuildFailure(error)) {
                await ctx.dispose();
                throw error;
            }
            // The errors were printed by the onEnd hook.
            buildFailed = true;
        }
        await ctx.dispose();
        return buildFailed || state.assetsFailed || state.hookFailed ? 1 : 0;
    }

    const manifestFile = path.join(cwd, "manifest.json");
    try {
        state.watching = true;
        // Register before ctx.watch(): its first build, the only one at start, then comes after the pollers took
        // their baseline. A failed first build keeps the watch alive: fixing the file triggers the next build.
        pollCssFiles();
        watchFile(manifestFile, { interval: POLL_INTERVAL_MS }, syncAssets);
        if (build.css !== false && cssEntry !== undefined && !existsSync(cssEntry)) {
            options.reporter.warn("build", `${id}: no ${build.css.entry}, CSS not watched`);
        }
        await ctx.watch();
        await firstBuild;
        options.reporter.info("build", `${id}: Watching for changes (Ctrl+C to stop)`);
        await aborted(options.signal);
    } finally {
        state.watching = false;
        for (const file of polled) {
            unwatchFile(file, onCssPoll);
        }
        polled.clear();
        unwatchFile(manifestFile, syncAssets);
        await ctx.dispose();
    }
    options.reporter.info("build", `${id}: watch stopped`);
    return 0;
}

/** Paths that cannot be a vault plugin folder, even with `--force`. */
function checkVaultDirArgument(dir: string, vaultDir: string, cwd: string): string | undefined {
    if (dir.startsWith("~")) {
        return `"${dir}" starts with "~", which is not expanded here. Pass an absolute path.`;
    }
    if (vaultDir === path.resolve(cwd)) {
        return "the vault folder cannot be the plugin root, the build would overwrite main.js and manifest.json in place. Pass the plugin folder inside your dev vault.";
    }
    return undefined;
}

/**
 * Refuses to write into a folder that holds a different plugin. `VAULT_PLUGIN` stays exported in a shell,
 * so a build of plugin B would silently overwrite plugin A's main.js and manifest.json in the dev vault.
 * A folder without a readable manifest is treated as fresh.
 */
export function checkVaultTarget(vaultDir: string, pluginId: string): string | undefined {
    const other = readTargetPluginId(path.join(vaultDir, "manifest.json"));
    if (other === undefined || other === pluginId) {
        return undefined;
    }
    return `${vaultDir} holds plugin ${other}, not ${pluginId}. Check VAULT_PLUGIN / --vault, or pass --force to overwrite it.`;
}

function readTargetPluginId(manifestFile: string): string | undefined {
    try {
        const parsed: unknown = JSON.parse(readFileSync(manifestFile, "utf8"));
        if (typeof parsed === "object" && parsed !== null && "id" in parsed && typeof parsed.id === "string") {
            return parsed.id;
        }
    } catch {
        // No manifest, or one that is not JSON: nothing there to protect.
    }
    return undefined;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function aborted(signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve) => {
        if (signal === undefined) {
            return;
        }
        if (signal.aborted) {
            resolve();
            return;
        }
        signal.addEventListener("abort", () => {
            resolve();
        }, { once: true });
    });
}

import path from "node:path";
import type { BuildOptions } from "esbuild";
import type { BuildConfig, BuildLoader } from "../config/types.js";

/**
 * Always external: Obsidian provides them at runtime. `build.external` adds to this list.
 * The CodeMirror packages must stay external or the plugin would load a second copy of the editor.
 */
export const DEFAULT_EXTERNAL: readonly string[] = ["obsidian", "electron", "@codemirror/state", "@codemirror/view"];

/**
 * Obsidian reads `module.exports` as the plugin class. esbuild's cjs output of an ES default export
 * puts it on `module.exports.default`, so the footer unwraps it.
 */
export const CJS_FOOTER = "module.exports = module.exports.default || module.exports;";

/**
 * Loaders every build starts with; `build.loader` entries merge over it. Dashy's and Snipsy's vault
 * builds had `.css` as text, so an `import "x.css"` meant as a string does not fail with
 * "No loader is configured for .css".
 */
export const DEFAULT_LOADER: Readonly<Record<string, BuildLoader>> = { ".css": "text" };

export interface ResolvedCss {
    readonly entry: string;
    readonly outfile: string;
}

/** The build section with every default filled in. Paths are still relative to the plugin root. */
export interface ResolvedBuild {
    readonly entry: string;
    readonly outfile: string;
    readonly minify: boolean;
    readonly target: string;
    readonly external: readonly string[];
    readonly loader: Readonly<Record<string, BuildLoader>>;
    readonly css: ResolvedCss | false;
}

/** Fills the defaults (Dashy's release build) into the user's `build` section. */
export function resolveBuild(config: BuildConfig | undefined): ResolvedBuild {
    const css = config?.css;
    return {
        entry: config?.entry ?? "src/main.ts",
        outfile: config?.outfile ?? "main.js",
        minify: config?.minify ?? true,
        target: config?.target ?? "es2020",
        external: [...new Set([...DEFAULT_EXTERNAL, ...(config?.external ?? [])])],
        loader: { ...DEFAULT_LOADER, ...config?.loader },
        css:
            css === false
                ? false
                : {
                      entry: css?.entry ?? "src/styles/main.css",
                      outfile: css?.outfile ?? "styles.css",
                  },
    };
}

export type BuildTarget =
    | { readonly kind: "release" }
    /** Dev vault: not minified, written to `<dir>/main.js`. */
    | { readonly kind: "vault"; readonly dir: string };

/**
 * esbuild options for one build. Platform `browser`, format `cjs` and the footer are fixed on purpose:
 * a plugin that runs on phones cannot use the Node build of its dependencies (see the bundle check).
 * `absWorkingDir` makes module resolution start at the plugin, not at the kit.
 */
export function toEsbuildOptions(build: ResolvedBuild, cwd: string, target: BuildTarget): BuildOptions {
    const vault = target.kind === "vault";
    return {
        absWorkingDir: cwd,
        entryPoints: [path.resolve(cwd, build.entry)],
        bundle: true,
        outfile: vault ? path.join(path.resolve(cwd, target.dir), "main.js") : path.resolve(cwd, build.outfile),
        minify: vault ? false : build.minify,
        platform: "browser",
        format: "cjs",
        target: build.target,
        external: [...build.external],
        loader: { ...build.loader },
        footer: { js: CJS_FOOTER },
        // The command prints esbuild's messages itself, through the injected stdout/stderr.
        logLevel: "silent",
    };
}

export interface VaultDir {
    readonly dir: string;
    /** Where the folder came from, so the command can say it: a stray VAULT_PLUGIN is easy to forget. */
    readonly source: "flag" | "env";
}

/** Where `opdk build --vault` writes: the flag, else `VAULT_PLUGIN`, else an error that says how to fix it. */
export function resolveVaultDir(
    flagDir: string | undefined,
    env: Readonly<Record<string, string | undefined>>,
    pluginId: string,
): VaultDir {
    if (flagDir !== undefined) {
        return { dir: flagDir, source: "flag" };
    }
    const dir = env.VAULT_PLUGIN;
    if (dir === undefined || dir === "") {
        throw new Error(
            "No dev vault plugin folder given. Pass it as `opdk build --vault <dir>` or set VAULT_PLUGIN to your plugin folder path and rerun. Example:\n" +
                `VAULT_PLUGIN="/absolute/path/to/vault/.obsidian/plugins/${pluginId}" opdk build --vault`,
        );
    }
    return { dir, source: "env" };
}

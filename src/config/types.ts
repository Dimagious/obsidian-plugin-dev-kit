import type { Loader } from "esbuild";

/** esbuild loaders accepted in `build.loader`. */
export const BUILD_LOADERS = [
    "base64",
    "binary",
    "copy",
    "css",
    "dataurl",
    "default",
    "empty",
    "file",
    "js",
    "json",
    "jsx",
    "local-css",
    "text",
    "ts",
    "tsx",
] as const satisfies readonly Loader[];

export type BuildLoader = (typeof BUILD_LOADERS)[number];

/** `build.css`: the stylesheet bundler's entry and output, relative to the plugin root. */
export interface BuildCssConfig {
    /** Default `src/styles/main.css`. */
    readonly entry?: string;
    /** Default `styles.css`. */
    readonly outfile?: string;
}

/** `build` section. Every key is optional; defaults are the Dashy release build. */
export interface BuildConfig {
    /** Default `src/main.ts`. */
    readonly entry?: string;
    /** Default `main.js`. */
    readonly outfile?: string;
    /** Default `true`. */
    readonly minify?: boolean;
    /** esbuild target. Default `es2020`. */
    readonly target?: string;
    /** Added to the always-external `obsidian`, `electron`, `@codemirror/state`, `@codemirror/view`. */
    readonly external?: readonly string[];
    /** esbuild loader map, for example `{ ".png": "dataurl" }`. */
    readonly loader?: Readonly<Record<string, BuildLoader>>;
    /** CSS bundler settings, or `false` to skip the CSS step. */
    readonly css?: BuildCssConfig | false;
}

/**
 * Per-plugin settings from `opdk.config.mjs`. Each kit module adds one optional section
 * here (for example `build?: BuildConfig`) and registers its key in CONFIG_SECTIONS.
 * Plugin id and name never live here: they come from manifest.json.
 */
export interface OpdkConfig {
    readonly build?: BuildConfig;
}

/**
 * One entry per OpdkConfig key. The Record type makes the compiler demand an entry
 * when a section is added, so the allowed-keys check cannot drift from the type.
 */
export const CONFIG_SECTIONS: Record<keyof OpdkConfig, true> = { build: true };

/** The subset of manifest.json the kit reads. */
export interface Manifest {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly minAppVersion?: string;
    readonly isDesktopOnly?: boolean;
}

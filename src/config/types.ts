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

/** `scan` section. Every key is optional. */
export interface ScanConfig {
    /**
     * Globs relative to the plugin root (`*`, `**` and `?` only). Tracked files that match are skipped by every
     * scan check. Default none: the scanner may well read `site/`, so leaving a folder out has to be a decision.
     */
    readonly ignore?: readonly string[];
}

export type DemoLayout = "plain" | "phone-captions";

/** `demo.gif` and the per-film `gif`: how the GIF is made. */
export interface DemoGifConfig {
    /** Pixels. Default: the frame width, at most 1000 (GitHub shows a README at about that width). Never wider than the frames. */
    readonly width?: number;
    /** Palette size, 2 to 256. Default 128. */
    readonly colors?: number;
    /** Frames per second, 1 to 50. Default: 10, or the film's fps when that is lower. A value set here is used as given. */
    readonly fps?: number;
}

/** `demo.poster` and the per-film `poster`: the still of the first frame. */
export interface DemoPosterConfig {
    /** Pixels. Default: the width of the MP4, so the poster is as sharp as the video it stands in for. Never wider than the frames. */
    readonly width?: number;
}

/** `demo.budget` and the per-film `budget`: sizes of one finished file, in bytes. */
export interface DemoBudgetConfig {
    /** A file above this prints a warning. Default 2 MB (2097152). */
    readonly warnBytes?: number;
    /** A file above this fails the command. Default 10 MB (10485760), GitHub's limit for images and GIFs attached to issues and pull requests. */
    readonly failBytes?: number;
}

/** What `opdk demo` does when the last frame of a film is not the first one (the GIF would jump when it loops). */
export type DemoLoopMode = "warn" | "fail" | "off";

/** The four colours of the `"phone-captions"` layout. Values go into CSS: none may contain `;{}<>\`, `/*` or `url(`, and quotes are refused. */
export interface DemoPhoneColors {
    readonly background?: string;
    readonly text?: string;
    /** Colour of the captions that are not the current step. */
    readonly muted?: string;
    /** Colour of the current step's number. */
    readonly accent?: string;
}

/**
 * `demo.phone` and the per-film `phone`: colours, font and title of the `"phone-captions"` layout.
 *
 * The colours can be set for both themes at the top level, and per theme under `light` and `dark`; a film shot in a
 * theme (`demo.themes()`) reads its own entry on top of the top level. A film without a theme reads the top level
 * and the light defaults.
 */
export interface DemoPhoneConfig extends DemoPhoneColors {
    readonly light?: DemoPhoneColors;
    readonly dark?: DemoPhoneColors;
    /** CSS font-family list, checked like the colours except that balanced quotes are allowed. Default: the stack Obsidian uses for its interface. */
    readonly font?: string;
    /** Heading above the caption list; none by default. HTML-escaped; a `\n` starts a new line. */
    readonly title?: string;
}

/** What can be set for every film (top level of `demo`) or for one film (`demo.films.<name>`). */
export interface DemoFilmConfig {
    /** An object tunes the GIF, `false` skips it. Default on. */
    readonly gif?: DemoGifConfig | false;
    /** Default `true`. */
    readonly mp4?: boolean;
    /** `false` skips the poster, `true` or an object makes it. Default on. */
    readonly poster?: DemoPosterConfig | boolean;
    /** `"plain"` encodes the frames as shot; `"phone-captions"` first puts each phone frame beside its caption list. Default `"plain"`. */
    readonly layout?: DemoLayout;
    readonly budget?: DemoBudgetConfig;
    /** Default `"warn"`. The check compares the film's own first and last frame, before any layout. */
    readonly loop?: DemoLoopMode;
    readonly phone?: DemoPhoneConfig;
}

/** `demo.stills`: where the stills of `demo.still()` are published. */
export interface DemoStillsConfig {
    /** Folder for the stills, relative to the plugin root. Default: `demo.output`, next to the films. */
    readonly output?: string;
}

/** `demo` section. Every key is optional. */
export interface DemoConfig extends DemoFilmConfig {
    /** Where the `demo` fixture wrote films and stills; the same default as the fixture, `.opdk/demo`. */
    readonly outDir?: string;
    /** Where the finished media go, relative to the plugin root. Default `docs/screens`. `opdk demo` adds files and replaces files of the same name; it never deletes. */
    readonly output?: string;
    /** `false` leaves the stills in `outDir`, an object publishes them to its own folder. Default on: every `<outDir>/stills/<name>.png` is copied to `output` as `<name>.png`, when its bytes changed. */
    readonly stills?: DemoStillsConfig | boolean;
    /** Overrides by film name. A theme pair (`x-light`, `x-dark`) also reads the entry `x`; the exact name wins. */
    readonly films?: Readonly<Record<string, DemoFilmConfig>>;
}

/**
 * Per-plugin settings from `opdk.config.mjs`. Each kit module adds one optional section
 * here (for example `build?: BuildConfig`) and registers its key in CONFIG_SECTIONS.
 * Plugin id and name never live here: they come from manifest.json.
 */
export interface OpdkConfig {
    readonly build?: BuildConfig;
    readonly scan?: ScanConfig;
    readonly demo?: DemoConfig;
}

/**
 * One entry per OpdkConfig key. The Record type makes the compiler demand an entry
 * when a section is added, so the allowed-keys check cannot drift from the type.
 */
export const CONFIG_SECTIONS: Record<keyof OpdkConfig, true> = { build: true, scan: true, demo: true };

/** The subset of manifest.json the kit reads. */
export interface Manifest {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly minAppVersion?: string;
    readonly isDesktopOnly?: boolean;
}

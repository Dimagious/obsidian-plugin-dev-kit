import type { Locator } from "@playwright/test";
import type { DemoRect } from "./clip.js";
import type { FilmFrame, FilmKind } from "./manifest.js";
import type { ThemeMode } from "./names.js";
import type { DemoPresetName } from "./presets.js";

export type { DemoPresetName, DemoRect, FilmFrame, FilmKind, ThemeMode };

/** Picture options both films and stills take. */
export interface CaptureOptions {
    /**
     * Shoots only this area: an element (its bounding box), or a rectangle in CSS pixels from the window's top-left
     * corner. The shot fails when the area sticks out of the window; scroll the target into view first, or make the
     * window bigger. Films need every frame to have the same size.
     */
    readonly clip?: Locator | DemoRect;
    /** CSS pixels added around `clip` on every side, cut at the window edge. Default 0. */
    readonly padding?: number;
    /** Selectors that must not be visible in this picture, on top of `demo.forbiddenSelectors`. */
    readonly forbiddenSelectors?: readonly string[];
    /**
     * Take the picture although the run uses a vault from `OPDK_E2E_VAULT`, or a seed vault outside the plugin folder
     * (the directory `playwright test` runs in). Default false: such a run is refused.
     */
    readonly allowForeignVault?: boolean;
}

export interface FilmOptions extends CaptureOptions {
    /** Folder name of the film under `<outDir>/films/`. Default: the describe titles and the test title (and the project name when the config has several), lower case with dashes. A film with the same name is replaced by a later run; a second test of the same run that gets the same name fails. */
    readonly name?: string;
    /** `phone` films are shot in the mobile emulation (`obsidian.mobile()`), `desktop` films without it; the shot fails otherwise. */
    readonly kind: FilmKind;
    /** Frames per second the film is encoded at. Default 15. */
    readonly fps?: number;
    /** Texts a composed phone film lists beside the phone. A shot points at one by index. They are not drawn into the frames: use `demo.caption()` for that. */
    readonly captions?: readonly string[];
    /** Device pixels per CSS pixel. Default: `demo.scale` of the options, 2. */
    readonly scale?: number;
    /**
     * Show the cursor arrow in this film's frames. Default true. The arrow follows every mouse action of Playwright
     * (`click()`, `check()`, `selectOption()`, `hover()`), not only `demo.moveAndClick()`, so a film that never meant to
     * show a cursor has it at the place of the last click. `false` keeps it hidden in this film's frames, however the
     * page was clicked. The tap dot of a phone film is not affected.
     */
    readonly cursor?: boolean;
}

export interface ShotOptions {
    /** Seconds the frame stays on screen. */
    readonly hold: number;
    /** Index into the film's `captions`. */
    readonly caption?: number;
    /** Overrides the film's clip for this frame. */
    readonly clip?: Locator | DemoRect;
    /** Overrides the film's padding for this frame. */
    readonly padding?: number;
    /**
     * Run `obsidian.settle()` before the page is frozen: waits until the DOM has been quiet for 150 ms, fonts are loaded
     * and the images in view are complete (budget: `timeouts.helpers.ui`). Default false, so a loading state filmed on
     * purpose is taken as it is. A pause longer than `quietMs` before the render looks settled: assert on the element
     * or raise `quietMs` (call `obsidian.settle({ quietMs })` yourself).
     */
    readonly settle?: boolean;
}

/** A film being recorded. */
export interface Film {
    readonly name: string;
    /** Absolute folder of the frames and the manifest. */
    readonly dir: string;
    /**
     * Freezes the page, takes one frame and appends it to the manifest. Call it after the assertion that the app is in
     * the state the frame should show; nothing here waits for the app.
     */
    shot(options: ShotOptions): Promise<FilmFrame>;
}

export interface StillOptions extends CaptureOptions {
    /** A destination: the PNG has exactly its pixels. Cannot be combined with `clip` or `scale`. */
    readonly preset?: DemoPresetName;
    /** Device pixels per CSS pixel. Default: `demo.scale` of the options, 2. */
    readonly scale?: number;
    /**
     * Run `obsidian.settle()` before the page is frozen: waits until the DOM has been quiet for 150 ms, fonts are loaded
     * and the images in view are complete (budget: `timeouts.helpers.ui`). Default false, so a loading state filmed on
     * purpose is taken as it is. A pause longer than `quietMs` before the render looks settled: assert on the element
     * or raise `quietMs` (call `obsidian.settle({ quietMs })` yourself).
     */
    readonly settle?: boolean;
}

export interface StillResult {
    /** Absolute path of the PNG. */
    readonly file: string;
    /** Pixels. */
    readonly width: number;
    readonly height: number;
}

/**
 * Which parts of the UI `demo.cleanUi()` hides. `true`, the default of every key, hides the part; `false` shows it.
 * Each call sets the first five, so the last call decides. `sidebars` is different: it only folds the panels, once,
 * and `false` leaves them as they are.
 */
export interface CleanUiOptions {
    readonly ribbon?: boolean;
    readonly statusBar?: boolean;
    /** The row of tabs with the sidebar toggles and the `+` button. */
    readonly tabHeaders?: boolean;
    /** The bar above a note with back and forward, the title and the view actions. */
    readonly viewHeader?: boolean;
    /** The note title above the text. */
    readonly inlineTitle?: boolean;
    /** Folds the left and right side panels (the file explorer, the outline). `false` keeps them as they are. */
    readonly sidebars?: boolean;
}

export interface TypeSlowlyOptions {
    /** Milliseconds between keys. Default 40. */
    readonly delayMs?: number;
}

export interface TapOptions {
    /** Runs while the finger is down (the dot is small), for a frame of the press: `whilePressed: () => film.shot({ hold: 0.3 })`. */
    readonly whilePressed?: () => Promise<unknown>;
}

/** The `demo` fixture: films and stills of the running Obsidian, overlays, and the settings that make a picture reproducible. */
export interface DemoHelpers {
    /**
     * Starts a film of stills. The film's folder is emptied now, so a retake replaces its frames. Throws at once when
     * the run uses a foreign vault, when this test already started a film with the same name, and when another test of
     * this run wrote a film of that name (each film folder holds an `owner.json` that says who wrote it).
     */
    film(options: FilmOptions): Film;
    /**
     * Takes one picture, `<outDir>/stills/<name>.png`, replacing an earlier one. Fails when another test of this run
     * wrote a still of that name.
     */
    still(name: string, options?: StillOptions): Promise<StillResult>;

    /** Moves the cursor to the target in steps the viewer can follow and clicks it. Fails when the target is not visible. */
    moveAndClick(target: Locator): Promise<void>;
    /** Puts the tap dot on the target, presses and releases it, then hides the dot. Fails when the target is not visible. */
    tap(target: Locator, options?: TapOptions): Promise<void>;
    /** Types into the focused element, key by key. Fails when nothing editable (an input, a textarea, a contenteditable) has focus. */
    typeSlowly(text: string, options?: TypeSlowlyOptions): Promise<void>;
    /** Clicks the target with the cursor, then types into it, key by key. Fails when the target is not visible. */
    typeSlowly(target: Locator, text: string, options?: TypeSlowlyOptions): Promise<void>;
    /**
     * Waits `seconds` for the viewer's sake, a deliberate pause in the pacing of a recorded take. Seconds, not
     * milliseconds (Snipsy's `beat` took milliseconds): more than 60 fails. It is not a wait for the app: use an
     * assertion for that. Films of stills take their timing from `hold`, not from this.
     */
    beat(seconds: number): Promise<void>;
    /** Shows a caption bar at the bottom of the window (in every frame until changed), or removes it with `null`. The text is shown as plain text. */
    caption(text: string | null): Promise<void>;
    /** Hides the cursor or the tap dot until the mouse moves again. */
    hideCursor(): Promise<void>;

    /**
     * Hides parts of the UI that distract from a picture, using Obsidian's own settings where they exist and a class on
     * the page for the status bar and the tab headers, and folds both side panels. It survives `reload()`, `mobile()` and `desktop()`.
     */
    cleanUi(options?: CleanUiOptions): Promise<void>;
    /**
     * Freezes the clock of the window at `date`: `new Date()`, `Date.now()` and `moment()` return it, timers keep
     * running. It survives `reload()`. A date string without a time zone is read in the time zone of the machine
     * running the test, and the page shows it in that zone too, so the same test gives the same text everywhere; a
     * string with `Z` or an offset shows a different wall clock time in another zone.
     *
     * Limits: the dates of files in Obsidian's explorer or in search come from the file system and are not frozen, and
     * code that measures elapsed time with `Date.now()` sees none pass (timers still fire).
     */
    freezeTime(date: Date | string | number): Promise<void>;
    /**
     * Runs `scene` once per theme, in order. Inside it `film()` and `still()` add `-light` or `-dark` to their names, so
     * one scene gives `<name>-light` and `<name>-dark`. The theme stays on the last one afterwards.
     */
    themes(modes: readonly ThemeMode[], scene: (mode: ThemeMode) => Promise<void>): Promise<void>;
}

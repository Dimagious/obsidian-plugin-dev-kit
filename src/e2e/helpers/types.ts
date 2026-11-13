import type { Locator } from "@playwright/test";
import type { CompositionChunking } from "./ime.js";
import type { FocusRingOptions, LayoutCheckName, LayoutCheckOptions, LayoutProblem, OverflowOptions, TouchTargetOptions } from "./layout.js";
import type { MobileOptions } from "./mobile.js";
import type { SettleOptions } from "./settle.js";
import type { ViewMode } from "./view-mode.js";

export type { CompositionChunking, FocusRingOptions, LayoutCheckName, LayoutCheckOptions, LayoutProblem, MobileOptions, OverflowOptions, SettleOptions, TouchTargetOptions, ViewMode };

/** A position in a note; both numbers start at 0. */
export interface EditorPosition {
    line: number;
    ch: number;
}

export interface EditorSelection {
    /** The selected text; empty when the cursor is a caret. */
    text: string;
    /** Where the selection started. */
    anchor: EditorPosition;
    /** Where the cursor is: the moving end of the selection. */
    head: EditorPosition;
}

/** The editor of the active note. All of it works on the real CodeMirror in the page. */
export interface EditorHelpers {
    /**
     * Types `text` key by key, so per-keystroke listeners (a snippet expander) fire; `fill()` would set the text in one
     * mutation. Clicks the editor to focus it only when it is not focused yet: clicking again would move the cursor
     * to the click point and break a typing sequence that depends on where the previous step left it.
     */
    type(text: string): Promise<void>;
    /** The whole document, read through `getValue()`: CodeMirror only keeps the visible lines in the DOM. */
    text(): Promise<string>;
    /** Selects everything with the keyboard, deletes it and waits until the document is empty. */
    clear(): Promise<void>;
    /** Focuses the editor and puts the cursor at `line`, `ch` (both from 0). A position past the end is clamped. */
    setCursor(line: number, ch: number): Promise<void>;
    selection(): Promise<EditorSelection>;
    /**
     * Enters `text` the way an input method does, through real composition events: `Input.imeSetComposition` while it
     * grows, `Input.insertText` to commit it. With `chunking: "word"` (the default) each word is composed and
     * committed with its trailing space; with `"character"` each character is its own composition. Inserts at the
     * cursor, and fails when the document did not change.
     */
    compose(text: string, options?: { chunking?: CompositionChunking }): Promise<void>;
}

export interface ThemeOptions {
    mode: "light" | "dark";
    /** The name of an installed community theme; `""` selects the default theme. Leave out to keep the current one. */
    theme?: string;
}

/** The handle `replace()` returns. */
export interface FakeHandle {
    /** The arguments of every call so far, oldest first. Works after `restore()` too. */
    calls(): Promise<unknown[][]>;
    /**
     * Puts the original value back. Calling it twice is harmless. Fails when the window has been reloaded since
     * `replace()` (`mobile()`, `desktop()`, a reload): the page forgot the replacement, and `calls()` fails the same way.
     */
    restore(): Promise<void>;
}

/** The function that replaces a property: what `replace()` installs, and what its factory returns. */
export type PageFunction = (...args: never[]) => unknown;

/**
 * What a test hands to `replace()`: a factory that runs once in the page, gets the `arg` of `replace()` and returns
 * the replacement. It is serialised as source text, so it cannot close over variables of the test (a reference to one
 * fails in the page with a ReferenceError); everything it needs goes through `arg`.
 */
export type PageFactory<A> = (arg: A) => PageFunction;

/** The helpers of the `obsidian` fixture, bound to the test's window. */
export interface ObsidianHelpers {
    /**
     * Opens Settings in the main window and returns the content of the open tab. `tab` is a plugin id or a core tab id
     * (for example `"editor"`); without it the modal opens on its default tab. A plugin may register its tab a moment
     * after the window is up, so the helper polls `app.setting.pluginTabs` and `settingTabs` and fails, listing the
     * registered ids, when the tab does not appear.
     */
    openSettings(tab?: string): Promise<Locator>;
    closeSettings(): Promise<void>;

    /**
     * Runs a command by id (`pluginId:command-id`). Fails with the close matches when the id does not exist, and when
     * the command declined to run (its `checkCallback` returned false: the command needs a state that is not there,
     * such as an open note).
     */
    runCommand(id: string): Promise<void>;
    /** Opens the command palette (`Mod+P`) and returns its input. */
    openCommandPalette(): Promise<Locator>;
    /** Runs a command through the palette: types `name`, waits for the entry to be selected, presses Enter. */
    runCommandFromPalette(name: string): Promise<void>;

    /**
     * Opens a note by vault path in the active tab. With `mode` it also makes sure the note is shown that way, also
     * when it is already open in the tab (where `openFile` alone keeps the mode it has).
     */
    openFile(path: string, options?: { mode?: ViewMode }): Promise<void>;
    /** The editor of the active note. */
    editor(): EditorHelpers;
    /** Presses a key or combination. `Mod` is Cmd on macOS and Ctrl elsewhere: `press("Mod+P")`. */
    press(keys: string): Promise<void>;

    /** Switches light or dark, and optionally the community theme, and waits until the page carries the class. */
    setTheme(options: ThemeOptions): Promise<void>;
    /** Waits until every markdown file in the vault has its metadata cached. */
    waitForMetadataCache(): Promise<void>;
    /** Removes the notices on screen (such as "Indexing complete.") and returns how many there were. */
    clearNotices(): Promise<number>;
    /**
     * Fails with the list of everything wrong in the layout of `options.root`: horizontal overflow, touch targets under
     * 44 px (by default only in the mobile emulation) and, when asked, a Tab stop without a focus ring. The checks read
     * the page as it is, so open and settle it first. Each can be turned off; see `LayoutCheckOptions`.
     */
    checkLayout(options: LayoutCheckOptions): Promise<void>;
    /** The same checks as `checkLayout()`, returned as a list (empty when all is well) instead of thrown, for `expect.soft` or a report. */
    layoutProblems(options: LayoutCheckOptions): Promise<LayoutProblem[]>;
    /**
     * Hides the properties block of notes, a display setting; the notes are unchanged. It saves the setting to the
     * vault's `.obsidian/app.json` at once (`vault.saveConfig()`), so a later settings save does not bring the block
     * back. It throws on an Obsidian that has no `vault.setConfig` or `vault.saveConfig`, because it would not stick.
     */
    hideProperties(): Promise<void>;
    /**
     * Scrolls a reading view from top to bottom so blocks that draw when visible are drawn. It stays at the bottom
     * and does not scroll back: the reading view drops the sections that leave the viewport, and scrolling back would
     * drop the drawn blocks.
     */
    scrollThrough(selector?: string): Promise<void>;
    /** Shows a note in reading view (the active note when `path` is left out). */
    readingView(path?: string): Promise<void>;
    /**
     * Collapses the left and right side panels and waits until both are collapsed, so the note pane gets the whole
     * window (a 390 px viewport is then 390 px of note, not of sidebars). It is a helper of its own, not an option of
     * `readingView()`, because it is about the window layout and also serves source and live mode and screenshots.
     * It then writes the workspace layout to disk, so a `reload()` right after it keeps the panels folded.
     */
    collapseSidebars(): Promise<void>;
    /** The inverse of `collapseSidebars()`: expands both side panels and waits until they are expanded. */
    expandSidebars(): Promise<void>;

    /**
     * Waits until the page stops changing: no DOM mutation for `quietMs` (default 150 ms), no font loading, and every
     * image in the viewport loaded. Use it in place of a fixed sleep before a picture or an assertion that cannot say
     * what it waits for. It sees changes that are happening, not ones only scheduled: a gap between two changes longer than
     * `quietMs` counts as quiet. CSS animations and transitions are not DOM changes, so an endless one does not hold it up.
     * `root` limits the watch to a part of the page (default: the `<body>`). The wait takes `timeouts.helpers.ui`;
     * when it runs out the error names `settle()`, says what was still changing and how to raise the budget.
     */
    settle(options?: SettleOptions): Promise<void>;

    /**
     * Switches Obsidian to its mobile interface in a phone-sized viewport (390 x 844 CSS pixels at scale 2 unless
     * given), waits until the window and every plugin have loaded again, and keeps the viewport phone-sized.
     * Plugins with `isDesktopOnly: true` do not load on mobile, so the wait fails naming them.
     */
    mobile(options?: MobileOptions): Promise<void>;
    /** Undoes `mobile()`. */
    desktop(): Promise<void>;
    /**
     * Reloads the window with Obsidian's own "Reload app without saving" command (`app:reload`) and waits until the
     * new page is up and every enabled plugin has loaded again, so the next line can use the editor or a plugin
     * without racing the load. Everything installed in the old page is gone afterwards, the fakes of `replace()`
     * included. Fails naming the command when this Obsidian has none, and with its own message when Obsidian refuses to run it. The command reloads without saving: wait until text typed just before it is written to the file.
     */
    reload(): Promise<void>;

    /**
     * Runs `fn(app, arg)` in the page, where `app` is `window.app`, and returns its result (a promise is awaited). The
     * generics let a spec annotate `app` with Obsidian's own type without the kit depending on the `obsidian` package:
     *
     *     import type { App } from "obsidian";
     *     const count = await obsidian.evaluate((app: App, folder: string) => app.vault.getFiles().filter((f) => f.path.startsWith(folder)).length, "Notes/");
     *
     * `fn` is serialised as source text and rebuilt in the page, so it cannot close over variables of the test or use
     * imports; pass what it needs as `arg`. `arg` and the result must be serialisable (as for `page.evaluate`): a
     * `TFile` or a DOM node does not survive, return the fields you need. An exception thrown by `fn` fails the test.
     * Fails with its own message when `window.app` is missing or `fn` cannot be rebuilt (a method shorthand such as
     * `{ run() {} }.run` is not a function expression).
     */
    // `App` appears once on purpose: it is the caller's statement about the type of `window.app`, as for `page.evaluate`.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    evaluate<R, App = unknown>(fn: (app: App) => R | Promise<R>): Promise<R>;
    /** The same with an `arg`: a function that declares a second parameter must be given it. */
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    evaluate<R, A, App = unknown>(fn: (app: App, arg: A) => R | Promise<R>, arg: A): Promise<R>;

    /**
     * Replaces `pluginId`'s property at `propertyPath` (dotted for nested ones) on the live plugin instance. `impl` is
     * a factory: it runs once in the page with `arg` and returns the function that becomes the property, so it can
     * keep state between calls in its closure:
     *
     *     await obsidian.replace("my-plugin", "client.fetch", (days: number) => async (path: string) => ({ days, path }), 7);
     *
     * `impl` is serialised as source text and rebuilt in the page, so it cannot close over variables of the test or
     * use imports; pass what it needs as `arg`, which must be serialisable (as for `page.evaluate`). The handle records
     * the arguments of each call to the replacement and puts the original back with `restore()`. Failure modes and
     * delays belong in the function `impl` returns. Fails when the plugin is not loaded, the property does not exist
     * or `impl` does not return a function.
     */
    replace(pluginId: string, propertyPath: string, impl: PageFactory<undefined>): Promise<FakeHandle>;
    /** The same with an `arg`: a factory that declares a parameter must be given it. */
    replace<A>(pluginId: string, propertyPath: string, impl: PageFactory<A>, arg: A): Promise<FakeHandle>;
}

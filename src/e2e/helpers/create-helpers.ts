import type { CDPSession, Locator, Page } from "@playwright/test";
import type { HelperTimeouts } from "../options.js";
import { waitForReady } from "../readiness.js";
import { commandDeclinedMessage, commandNotFoundMessage, toPlaywrightKeys } from "./commands.js";
import { planComposition } from "./ime.js";
import { deviceMetrics, isReloadRejection, type MobileOptions } from "./mobile.js";
import {
    applyTheme,
    closeSettingsModal,
    editorTextChanged,
    enabledPluginIds,
    hasInnerWidth,
    hasSettingTab,
    hideNoteProperties,
    installFake,
    isEditorEmpty,
    isEditorSettled,
    isFocusInside,
    isMetadataCacheComplete,
    isMobileApplied,
    isReloaded,
    isSchemeApplied,
    listSettingTabIds,
    markBeforeReload,
    metadataCacheState,
    openFileInMode,
    type PageViewState,
    openSettingsModal,
    placeEditorCursor,
    readActiveFilePath,
    readConfig,
    readEditorSelection,
    readEditorText,
    readFakeCalls,
    removeFake,
    removeNotices,
    runCommandById,
    runWithApp,
    scrollThroughElement,
    switchMobileEmulation,
} from "./page-scripts.js";
import { settingsNotOpenedMessage, settingsTabNotFoundMessage } from "./settings.js";
import type { EditorHelpers, EditorSelection, FakeHandle, ObsidianHelpers, PageFactory, ThemeOptions } from "./types.js";
import { viewModeFailureMessage, viewModeMatches, viewModeSelector, viewModeState, type ViewMode } from "./view-mode.js";

export interface HelperOptions {
    /** How long a reload (mobile, desktop) may take until every plugin has loaded again. The session's `timeouts.ready`. */
    readonly readyTimeoutMs: number;
    /** How long each kind of helper wait may take. The session's `timeouts.helpers`. */
    readonly timeouts: Required<HelperTimeouts>;
}

export interface HelperKit {
    readonly helpers: ObsidianHelpers;
    /** Detaches the CDP session the IME and mobile helpers opened. The window itself is closed by the session. */
    dispose(): Promise<void>;
}

/** How long the window may take to get a width it was told to have, or the `is-mobile` class, after a CDP or Obsidian call. */
const MOBILE_STATE_TIMEOUT_MS = 5_000;
const VIEW_MODE_ATTEMPTS = 5;
const POLL_MS = 50;
/**
 * The one fixed delay between key presses: the typing speed of `editor().type()`, not a wait for a condition. A
 * listener that reacts to a key can only be tested if keys do not arrive faster than it runs; Snipsy's hotstring
 * expander needed this, and 15 ms was enough there. (`scrollThrough` has a 100 ms fallback per step, in the page,
 * for a window that draws no frames.)
 */
const KEY_DELAY_MS = 15;
/** Per key press, on top of the delay: Playwright's own work for one key. The budget of a typing call is `ui` plus this for each. */
const TYPING_SLACK_MS = 50;
/**
 * The selectors below, and the ones in the helpers (`.modal.mod-settings`, `.vertical-tab-content`, `.prompt-input`,
 * `.prompt-results`, `.notice`), name Obsidian-internal DOM. They were verified on Obsidian 1.14.5. When a newer
 * Obsidian renames one, the helper that uses it fails with its own message, and the selector is the first suspect.
 *
 * The editor is not scoped to `.mod-active`: Obsidian briefly drops that class from the leaf while a modal is open
 * (Snipsy found this with the command palette), and a selector that needs it matches nothing right after the modal
 * closes. The first markdown editor in the workspace is the active one unless the layout is split.
 */
const EDITOR_SELECTOR = '.workspace-leaf-content[data-type="markdown"] .cm-content[contenteditable=true]';
const READING_VIEW_SELECTOR = ".workspace-leaf.mod-active .markdown-preview-view";

const NO_EDITOR = "There is no active editor. Open a note first, with openFile(), and make sure it is in source or live mode.";

/** Runs `action`; a failure is rethrown as `message` (what went wrong and what to do), with the original as `cause`. */
async function orFail<T>(action: () => Promise<T>, message: string): Promise<T> {
    try {
        return await action();
    } catch (error) {
        throw new Error(message, { cause: error });
    }
}

/** Builds the helpers of one test, bound to its window. Everything that waits polls state; none sleeps. */
export function createHelpers(win: Page, options: HelperOptions): HelperKit {
    const { timeouts } = options;
    let cdp: CDPSession | undefined;
    let fakeCount = 0;

    /** One CDP session per window, shared by the IME and mobile helpers: it works in both launch modes. */
    async function session(): Promise<CDPSession> {
        cdp ??= await win.context().newCDPSession(win);
        return cdp;
    }

    const press = async (keys: string): Promise<void> => {
        await win.keyboard.press(toPlaywrightKeys(keys));
    };

    async function openSettings(tab?: string): Promise<Locator> {
        if (tab !== undefined) {
            try {
                await win.waitForFunction(hasSettingTab, tab, { polling: 100, timeout: timeouts.settings });
            } catch (error) {
                const registered = await win.evaluate(listSettingTabIds);
                throw new Error(settingsTabNotFoundMessage(tab, registered, timeouts.settings), { cause: error });
            }
        }
        await win.evaluate(openSettingsModal, tab ?? null);
        const content = win.locator(".modal.mod-settings .vertical-tab-content");
        try {
            await content.waitFor({ state: "visible", timeout: timeouts.ui });
        } catch (error) {
            const popout = await win.evaluate(readConfig, "settingsPopoutWindow");
            throw new Error(
                settingsNotOpenedMessage({ popoutConfigured: popout === true, windows: win.context().pages().length, timeoutMs: timeouts.ui }),
                { cause: error },
            );
        }
        return content;
    }

    async function closeSettings(): Promise<void> {
        await win.evaluate(closeSettingsModal);
        await orFail(
            () => win.locator(".modal.mod-settings").waitFor({ state: "detached", timeout: timeouts.ui }),
            `The settings modal was still open ${String(timeouts.ui)} ms after closeSettings(). Is a dialog on top of it asking a question?`,
        );
    }

    async function runCommand(id: string): Promise<void> {
        const result = await win.evaluate(runCommandById, id);
        if (result.state === "missing") {
            throw new Error(commandNotFoundMessage(id, result.ids));
        }
        if (result.state === "declined") {
            throw new Error(commandDeclinedMessage(id));
        }
    }

    async function openCommandPalette(): Promise<Locator> {
        await press("Mod+P");
        const input = win.locator(".prompt-input");
        try {
            await input.waitFor({ state: "visible", timeout: timeouts.ui });
        } catch (error) {
            throw new Error(
                `The command palette did not open within ${String(timeouts.ui)} ms after Mod+P. Is the command-palette core plugin enabled in the seed vault's .obsidian/core-plugins.json?`,
                { cause: error },
            );
        }
        return input;
    }

    async function runCommandFromPalette(name: string): Promise<void> {
        const input = await openCommandPalette();
        await orFail(
            () => input.fill(name, { timeout: timeouts.ui }),
            `Could not type "${name}" into the command palette within ${String(timeouts.ui)} ms. Did another dialog take the focus?`,
        );
        // The list updates after the input does; Enter before the entry is selected would run the previous first entry.
        const entry = win.locator(".prompt-results .suggestion-item.is-selected", { hasText: name }).first();
        try {
            await entry.waitFor({ state: "visible", timeout: timeouts.ui });
        } catch (error) {
            throw new Error(`The command palette has no selected entry containing "${name}" after ${String(timeouts.ui)} ms. Check the command's name, and that its plugin is enabled.`, { cause: error });
        }
        await press("Enter");
        await orFail(
            () => input.waitFor({ state: "hidden", timeout: timeouts.ui }),
            `The command palette was still open ${String(timeouts.ui)} ms after Enter. The command may need an argument or open a dialog of its own.`,
        );
    }

    async function openFile(path: string, openOptions: { mode?: ViewMode } = {}): Promise<void> {
        const { mode } = openOptions;
        const opened = async (wanted: ReturnType<typeof viewModeState> | null): Promise<PageViewState | null> => {
            const result = await win.evaluate(openFileInMode, { path, wanted });
            if (!result.found) {
                throw new Error(`${path} is not in the vault. Give the path relative to the vault root, for example "Notes/Today.md".`);
            }
            return result.view;
        };
        if (mode === undefined) {
            await opened(null);
            return;
        }
        let last: PageViewState | null = null;
        // Setting the state of a note that is already open can be overtaken by the open itself, so ask again.
        for (let attempt = 1; attempt <= VIEW_MODE_ATTEMPTS; attempt++) {
            last = await opened(viewModeState(mode));
            if (viewModeMatches(last, mode)) {
                await orFail(
                    () => win.locator(viewModeSelector(mode)).first().waitFor({ state: "visible", timeout: timeouts.ui }),
                    `${path} reports ${mode} mode, but its view did not appear within ${String(timeouts.ui)} ms. Is a modal covering the workspace?`,
                );
                return;
            }
        }
        throw new Error(viewModeFailureMessage(path, mode, last, VIEW_MODE_ATTEMPTS));
    }

    /**
     * Clicks the editor to focus it, but only when focus is not already inside it (see `EditorHelpers.type`). Waits
     * for the editor first: right after a modal closes the editor may not be back in the DOM yet, and a focus check
     * made before that would see "not focused" and click, moving the cursor.
     */
    async function focusEditor(): Promise<Locator> {
        const editor = win.locator(EDITOR_SELECTOR).first();
        await orFail(() => editor.waitFor({ state: "visible", timeout: timeouts.ui }), `${NO_EDITOR} No editor appeared within ${String(timeouts.ui)} ms.`);
        if (!(await win.evaluate(isFocusInside, EDITOR_SELECTOR))) {
            await orFail(
                () => editor.click({ timeout: timeouts.ui }),
                `Could not click the editor within ${String(timeouts.ui)} ms. Is a modal or a popover covering it?`,
            );
        }
        return editor;
    }

    async function editorText(): Promise<string> {
        const text = await win.evaluate(readEditorText);
        if (text === null) {
            throw new Error(NO_EDITOR);
        }
        return text;
    }

    async function compose(text: string, composeOptions: { chunking?: "word" | "character" } = {}): Promise<void> {
        if (text === "") {
            return;
        }
        const steps = planComposition(text, composeOptions.chunking ?? "word");
        await focusEditor();
        const before = await editorText();
        const cdpSession = await session();
        for (const step of steps) {
            for (const progress of step.progress) {
                await cdpSession.send("Input.imeSetComposition", {
                    text: progress,
                    selectionStart: progress.length,
                    selectionEnd: progress.length,
                });
            }
            await cdpSession.send("Input.insertText", { text: step.commit });
            try {
                await win.waitForFunction(isEditorSettled, undefined, { polling: 20, timeout: timeouts.compose });
            } catch (error) {
                throw new Error(`CodeMirror was still composing ${String(timeouts.compose)} ms after "${step.commit}" was committed. Raise timeouts.helpers.compose if the editor is slow, or check for a plugin that holds the composition.`, { cause: error });
            }
        }
        try {
            await win.waitForFunction(editorTextChanged, before, { polling: 20, timeout: timeouts.compose });
        } catch (error) {
            throw new Error(
                `The document did not change within ${String(timeouts.compose)} ms after the composition. The editor may be read-only, or a plugin undid the text.`,
                { cause: error },
            );
        }
    }

    const editor = (): EditorHelpers => ({
        type: async (text) => {
            const locator = await focusEditor();
            await orFail(
                () => locator.pressSequentially(text, { delay: KEY_DELAY_MS, timeout: timeouts.ui + text.length * (KEY_DELAY_MS + TYPING_SLACK_MS) }),
                "Typing into the editor failed. Is the editor read-only, or did a modal take the focus?",
            );
        },
        text: editorText,
        clear: async () => {
            if ((await win.evaluate(readEditorText)) === null) {
                throw new Error(NO_EDITOR);
            }
            await focusEditor();
            await press("Mod+A");
            await press("Delete");
            await orFail(
                () => win.waitForFunction(isEditorEmpty, undefined, { polling: POLL_MS, timeout: timeouts.ui }),
                `The document was not empty ${String(timeouts.ui)} ms after select-all and delete. Is the editor read-only, or does a plugin restore the text?`,
            );
        },
        setCursor: async (line, ch) => {
            if (!Number.isInteger(line) || !Number.isInteger(ch) || line < 0 || ch < 0) {
                throw new RangeError(`setCursor(${String(line)}, ${String(ch)}): line and ch must be integers from 0.`);
            }
            if (!(await win.evaluate(placeEditorCursor, { line, ch }))) {
                throw new Error(NO_EDITOR);
            }
        },
        selection: async (): Promise<EditorSelection> => {
            const selection = await win.evaluate(readEditorSelection);
            if (selection === null) {
                throw new Error(NO_EDITOR);
            }
            return selection;
        },
        compose,
    });

    async function setTheme(themeOptions: ThemeOptions): Promise<void> {
        // A spec in plain JavaScript, or a cast, can pass anything.
        const given: string = themeOptions.mode;
        if (given !== "light" && given !== "dark") {
            throw new Error(`setTheme(): mode must be "light" or "dark", got ${JSON.stringify(given)}.`);
        }
        // Obsidian's names for the two colour schemes.
        const scheme = themeOptions.mode === "dark" ? "obsidian" : "moonstone";
        const result = await win.evaluate(applyTheme, { scheme, theme: themeOptions.theme ?? null });
        if (!result.ok) {
            const installed = result.themes.length > 0 ? result.themes.join(", ") : "none";
            throw new Error(`setTheme(): the theme "${String(themeOptions.theme)}" is not installed. Installed community themes: ${installed}. Check the name, or put the theme in the seed vault's .obsidian/themes.`);
        }
        await orFail(
            () => win.waitForFunction(isSchemeApplied, scheme, { polling: POLL_MS, timeout: timeouts.theme }),
            `setTheme(): the page did not get the ${themeOptions.mode} theme class within ${String(timeouts.theme)} ms. Raise timeouts.helpers.theme if the theme is slow to load.`,
        );
    }

    async function waitForMetadataCache(): Promise<void> {
        try {
            await win.waitForFunction(isMetadataCacheComplete, undefined, { polling: 100, timeout: timeouts.metadataCache });
        } catch (error) {
            const state = await win.evaluate(metadataCacheState);
            throw new Error(
                `Obsidian had indexed ${String(state.cached)} of ${String(state.total)} markdown files after ${String(timeouts.metadataCache)} ms. ` +
                    "Raise timeouts.helpers.metadataCache (and the test timeout, 60 s by default) for a big vault, or check the vault for a file Obsidian cannot parse.",
                { cause: error },
            );
        }
    }

    async function scrollThrough(selector = READING_VIEW_SELECTOR): Promise<void> {
        if (!(await win.evaluate(scrollThroughElement, selector))) {
            throw new Error(`scrollThrough(): nothing matches "${selector}". Is the note open in reading view?`);
        }
    }

    async function readingView(path?: string): Promise<void> {
        const target = path ?? (await win.evaluate(readActiveFilePath));
        if (target === null) {
            throw new Error("readingView(): no path given and no note is active. Pass a path, or open a note first with openFile().");
        }
        await openFile(target, { mode: "preview" });
    }

    /**
     * Switches the emulation and waits for the reload it causes. `emulateMobile()` reloads the window, so the call
     * that starts it never returns; that rejection is the only one accepted. The flag set before the call tells the
     * old page from the new one, and then the phase 1 readiness wait makes sure every plugin has loaded again.
     */
    async function switchEmulation(on: boolean): Promise<void> {
        const ids = await win.evaluate(enabledPluginIds);
        await win.evaluate(markBeforeReload);
        try {
            await win.evaluate(switchMobileEmulation, on);
        } catch (error) {
            if (!isReloadRejection(error)) {
                throw error;
            }
        }
        await orFail(
            () => win.waitForFunction(isReloaded, undefined, { polling: POLL_MS, timeout: options.readyTimeoutMs }),
            `The window did not reload within ${String(options.readyTimeoutMs)} ms after the mobile emulation was switched ${on ? "on" : "off"}. Raise timeouts.ready, or check that app.emulateMobile exists in this Obsidian.`,
        );
        await waitForReady(win, ids, options.readyTimeoutMs);
        await orFail(
            () => win.waitForFunction(isMobileApplied, on, { polling: POLL_MS, timeout: MOBILE_STATE_TIMEOUT_MS }),
            `The window reloaded, but its body ${on ? "lacks" : "still has"} the is-mobile class after ${String(MOBILE_STATE_TIMEOUT_MS)} ms.`,
        );
    }

    /** The window width the last `mobile()` call applied; the layout (phone or tablet) was decided from it. */
    let mobileWidth: number | undefined;

    async function waitForWidth(width: number): Promise<void> {
        await orFail(
            () => win.waitForFunction(hasInnerWidth, width, { polling: POLL_MS, timeout: MOBILE_STATE_TIMEOUT_MS }),
            `The window width did not become ${String(width)} within ${String(MOBILE_STATE_TIMEOUT_MS)} ms after the device metrics override.`,
        );
    }

    async function mobile(mobileOptions: MobileOptions = {}): Promise<void> {
        const metrics = deviceMetrics(mobileOptions);
        const cdpSession = await session();
        // The size first: whether Obsidian shows the phone or the tablet layout is decided when it loads, from the
        // viewport at that moment. The window may be larger than the screen allows, the override is not.
        await cdpSession.send("Emulation.setDeviceMetricsOverride", metrics);
        await waitForWidth(metrics.width);
        // Also when the window is mobile already but with another size (or one this helper did not set): the layout
        // class follows the size only at load, so it has to load again.
        if (!(await win.evaluate(isMobileApplied, true)) || mobileWidth !== metrics.width) {
            await switchEmulation(true);
        }
        // The override survives the reload; sending it again costs nothing and does not rely on that.
        await cdpSession.send("Emulation.setDeviceMetricsOverride", metrics);
        await waitForWidth(metrics.width);
        mobileWidth = metrics.width;
    }

    async function desktop(): Promise<void> {
        if (await win.evaluate(isMobileApplied, true)) {
            await switchEmulation(false);
        }
        await (await session()).send("Emulation.clearDeviceMetricsOverride");
    }

    // The overloads of ObsidianHelpers.evaluate: with and without an `arg`. `App` is the caller's type of `window.app`.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    async function evaluate<R, App = unknown>(fn: (app: App) => R | Promise<R>): Promise<R>;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    async function evaluate<R, A, App = unknown>(fn: (app: App, arg: A) => R | Promise<R>, arg: A): Promise<R>;
    async function evaluate<R, A, App = unknown>(fn: (app: App, arg?: A) => R | Promise<R>, arg?: A): Promise<R> {
        const result = await win.evaluate(runWithApp, { source: fn.toString(), arg });
        if (!result.ok) {
            throw new Error(`evaluate(): ${result.reason}. The function runs in the page, so it cannot use variables of the test; pass them as the second argument.`);
        }
        // The page returned whatever `fn` returned; the type parameter is the caller's statement about it.
        return result.value as R;
    }

    async function replace(pluginId: string, propertyPath: string, impl: PageFactory<undefined>): Promise<FakeHandle>;
    async function replace<A>(pluginId: string, propertyPath: string, impl: PageFactory<A>, arg: A): Promise<FakeHandle>;
    async function replace<A>(pluginId: string, propertyPath: string, impl: PageFactory<A>, arg?: A): Promise<FakeHandle> {
        fakeCount += 1;
        const id = `opdk-fake-${String(fakeCount)}`;
        const result = await win.evaluate(installFake, { id, pluginId, path: propertyPath, source: impl.toString(), arg });
        if (!result.ok) {
            throw new Error(
                `replace(${pluginId}, ${propertyPath}): ${result.reason}. Use the plugin id from manifest.json and a property that exists on the loaded plugin; ` +
                    "the factory runs in the page, so it cannot use variables of the test.",
            );
        }
        let finalCalls: unknown[][] | undefined;
        const calls = async (): Promise<unknown[][]> => {
            if (finalCalls !== undefined) {
                return finalCalls;
            }
            const recorded = await win.evaluate(readFakeCalls, id);
            if (recorded === null) {
                throw new Error(`The replacement of ${pluginId}.${propertyPath} is gone: the window was reloaded since replace().`);
            }
            return recorded;
        };
        return {
            calls,
            restore: async () => {
                if (finalCalls !== undefined) {
                    return;
                }
                const recorded = await calls();
                await win.evaluate(removeFake, id);
                finalCalls = recorded;
            },
        };
    }

    return {
        helpers: {
            openSettings,
            closeSettings,
            runCommand,
            openCommandPalette,
            runCommandFromPalette,
            openFile,
            editor,
            press,
            setTheme,
            waitForMetadataCache,
            clearNotices: () => win.evaluate(removeNotices),
            hideProperties: () => win.evaluate(hideNoteProperties),
            scrollThrough,
            readingView,
            mobile,
            desktop,
            evaluate,
            replace,
        },
        dispose: async () => {
            // A window that has closed took its session with it; there is nothing left to detach.
            if (cdp !== undefined && !win.isClosed()) {
                await cdp.detach();
            }
        },
    };
}

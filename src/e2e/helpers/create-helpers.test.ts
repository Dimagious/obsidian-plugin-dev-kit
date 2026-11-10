import { afterEach, describe, expect, it } from "vitest";
import { createFakeHelperWindow, type FakeHelperWindow } from "../../test-support/e2e-fakes.js";
import { isReady } from "../page-scripts.js";
import { createHelpers } from "./create-helpers.js";
import {
    applyTheme,
    areSidebarsCollapsed,
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
    setSidebarsCollapsed,
    switchMobileEmulation,
} from "./page-scripts.js";

/** Distinct values, so a test can tell which budget a wait took. */
const TIMEOUTS = { settings: 111, metadataCache: 222, compose: 333, theme: 444, ui: 555 } as const;

let current: FakeHelperWindow | undefined;

// Every wait a helper starts must carry an explicit timeout: Playwright's defaults reach the test timeout or never end.
// The fake records the ones that do not, so this holds for every test below without repeating it in each.
afterEach(() => {
    expect(current?.unbounded).toEqual([]);
});

function setUp(readyTimeoutMs = 30_000): { fake: FakeHelperWindow; helpers: ReturnType<typeof createHelpers>["helpers"]; dispose: () => Promise<void> } {
    const fake = createFakeHelperWindow();
    current = fake;
    const kit = createHelpers(fake.win, { readyTimeoutMs, timeouts: TIMEOUTS });
    return { fake, helpers: kit.helpers, dispose: () => kit.dispose() };
}

describe("settings", () => {
    it("waits for the tab to register, opens it and returns the content, in this order", async () => {
        const { fake, helpers } = setUp();
        let waited: unknown;
        fake.onWait(hasSettingTab, (tab, options) => {
            waited = { tab, options };
            fake.log.push("tab registered");
        });
        fake.onEvaluate(openSettingsModal, (tab) => fake.log.push(`open:${String(tab)}`));
        await helpers.openSettings("my-plugin");
        expect(waited).toEqual({ tab: "my-plugin", options: { polling: 100, timeout: 111 } });
        expect(fake.log).toEqual([
            "tab registered",
            "open:my-plugin",
            "locator:.modal.mod-settings .vertical-tab-content",
            "waitFor:.modal.mod-settings .vertical-tab-content:visible",
        ]);
    });

    it("opens on the default tab without waiting for one", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(openSettingsModal, (tab) => fake.log.push(`open:${String(tab)}`));
        await helpers.openSettings();
        expect(fake.log[0]).toBe("open:null");
    });

    it("fails with the registered ids when the tab never appears", async () => {
        const { fake, helpers } = setUp();
        fake.onWait(hasSettingTab, () => {
            throw new Error("Timeout 15000ms exceeded.");
        });
        fake.onEvaluate(listSettingTabIds, () => ["editor", "about"]);
        const error: unknown = await helpers.openSettings("nope").catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('No settings tab with id "nope"');
        expect((error as Error).message).toContain("Registered tabs: editor, about.");
        expect((error as Error).cause).toBeInstanceOf(Error);
        // The modal was not opened for a tab that does not exist.
        expect(fake.log).toEqual([]);
    });

    it("closes the modal and waits until it is gone", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(closeSettingsModal, () => fake.log.push("close"));
        await helpers.closeSettings();
        expect(fake.log).toEqual(["close", "locator:.modal.mod-settings", "waitFor:.modal.mod-settings:detached"]);
    });

    it("says what to check when the modal stays open", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(closeSettingsModal, () => undefined);
        fake.failWaitFor(".modal.mod-settings");
        await expect(helpers.closeSettings()).rejects.toThrow("still open 555 ms after closeSettings()");
    });

    it("gives the content its own budget and says what is wrong when it does not appear", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(openSettingsModal, () => undefined);
        fake.failWaitFor(".modal.mod-settings .vertical-tab-content");
        fake.onEvaluate(readConfig, () => undefined);
        await expect(helpers.openSettings()).rejects.toThrow("did not appear in the main window within 555 ms");
    });

    it("names the seed's app.json when Settings opened in a second window", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(openSettingsModal, () => undefined);
        fake.failWaitFor(".modal.mod-settings .vertical-tab-content");
        fake.windows = 2;
        fake.onEvaluate(readConfig, () => false);
        const error: unknown = await helpers.openSettings().catch((caught: unknown) => caught);
        expect((error as Error).message).toContain("opened it in a second window");
        expect((error as Error).message).toContain("settingsPopoutWindow");
        expect((error as Error).message).toContain("seed vault's app.json");
    });

    it("names the seed's app.json when the config says the popout is on, even before a second window shows", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(openSettingsModal, () => undefined);
        fake.failWaitFor(".modal.mod-settings .vertical-tab-content");
        fake.onEvaluate(readConfig, (key) => key === "settingsPopoutWindow");
        await expect(helpers.openSettings()).rejects.toThrow("seed vault's app.json");
    });
});

describe("commands and keys", () => {
    it("runs a command by id", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(runCommandById, (id) => ({ state: "ran", id }));
        await expect(helpers.runCommand("a:b")).resolves.toBeUndefined();
    });

    it("fails for an unknown id with the close matches", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(runCommandById, () => ({ state: "missing", ids: ["my-plugin:late-command", "app:open-settings"] }));
        await expect(helpers.runCommand("my-plugin:late-comand")).rejects.toThrow("Close matches: my-plugin:late-command.");
    });

    it("fails for a command that declined to run", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(runCommandById, () => ({ state: "declined" }));
        await expect(helpers.runCommand("editor:toggle-bold")).rejects.toThrow("checkCallback returned false");
    });

    it("presses keys with Mod mapped to ControlOrMeta", async () => {
        const { fake, helpers } = setUp();
        await helpers.press("Mod+Shift+P");
        await helpers.press("Escape");
        expect(fake.log).toEqual(["press:ControlOrMeta+Shift+P", "press:Escape"]);
        await expect(helpers.press("")).rejects.toThrow("press() needs a key");
    });

    it("opens the palette with Mod+P and returns its input once visible", async () => {
        const { fake, helpers } = setUp();
        await helpers.openCommandPalette();
        expect(fake.log).toEqual(["press:ControlOrMeta+P", "locator:.prompt-input", "waitFor:.prompt-input:visible"]);
        expect(fake.timeouts).toEqual([{ what: "waitFor:.prompt-input", timeout: 555 }]);
    });

    it("says what to check when the palette does not open", async () => {
        const { fake, helpers } = setUp();
        fake.failWaitFor(".prompt-input");
        await expect(helpers.openCommandPalette()).rejects.toThrow("did not open within 555 ms after Mod+P. Is the command-palette core plugin");
    });

    it("runs a command from the palette: types the name, waits for the entry to be selected, then Enter", async () => {
        const { fake, helpers } = setUp();
        await helpers.runCommandFromPalette("Late command");
        expect(fake.log).toEqual([
            "press:ControlOrMeta+P",
            "locator:.prompt-input",
            "waitFor:.prompt-input:visible",
            "fill:.prompt-input:Late command",
            "locator:.prompt-results .suggestion-item.is-selected[hasText=Late command]",
            "waitFor:.prompt-results .suggestion-item.is-selected[hasText=Late command]:visible",
            "press:Enter",
            "waitFor:.prompt-input:hidden",
        ]);
    });

    it("says what to check when the palette stays open after Enter", async () => {
        const { fake, helpers } = setUp();
        fake.failWaitFor(".prompt-input", "hidden");
        await expect(helpers.runCommandFromPalette("Late command")).rejects.toThrow("still open 555 ms after Enter");
    });

    it("does not press Enter when no entry is selected", async () => {
        const { fake, helpers } = setUp();
        fake.failWaitFor(".prompt-results .suggestion-item.is-selected");
        await expect(helpers.runCommandFromPalette("Nothing like this")).rejects.toThrow('no selected entry containing "Nothing like this"');
        expect(fake.log).not.toContain("press:Enter");
    });
});

describe("openFile", () => {
    it("opens without a mode in one call and waits for nothing else", async () => {
        const { fake, helpers } = setUp();
        const calls: unknown[] = [];
        fake.onEvaluate(openFileInMode, (arg) => {
            calls.push(arg);
            return { found: true, view: { mode: "source", source: false } };
        });
        await helpers.openFile("A.md");
        expect(calls).toEqual([{ path: "A.md", wanted: null }]);
        expect(fake.log).toEqual([]);
    });

    it("asks for the mode and waits for the matching view to be drawn", async () => {
        const { fake, helpers } = setUp();
        const calls: unknown[] = [];
        fake.onEvaluate(openFileInMode, (arg) => {
            calls.push(arg);
            return { found: true, view: { mode: "preview", source: false } };
        });
        await helpers.openFile("A.md", { mode: "preview" });
        expect(calls).toEqual([{ path: "A.md", wanted: { mode: "preview", source: false } }]);
        expect(fake.log).toEqual([
            "locator:.workspace-leaf.mod-active .markdown-reading-view",
            "waitFor:.workspace-leaf.mod-active .markdown-reading-view:visible",
        ]);
    });

    it("says what to check when the mode is set but the view does not appear", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(openFileInMode, () => ({ found: true, view: { mode: "preview", source: false } }));
        fake.failWaitFor(".workspace-leaf.mod-active .markdown-reading-view");
        await expect(helpers.openFile("A.md", { mode: "preview" })).rejects.toThrow("A.md reports preview mode, but its view did not appear within 555 ms");
    });

    it("asks again when the note stays in the wrong mode (a note already open in the tab), then succeeds", async () => {
        const { fake, helpers } = setUp();
        let attempts = 0;
        fake.onEvaluate(openFileInMode, () => {
            attempts += 1;
            return { found: true, view: attempts < 3 ? { mode: "source", source: true } : { mode: "preview", source: false } };
        });
        await helpers.openFile("A.md", { mode: "preview" });
        expect(attempts).toBe(3);
    });

    it("gives up after five attempts and says what the view was", async () => {
        const { fake, helpers } = setUp();
        let attempts = 0;
        fake.onEvaluate(openFileInMode, () => {
            attempts += 1;
            return { found: true, view: { mode: "source", source: true } };
        });
        await expect(helpers.openFile("A.md", { mode: "live" })).rejects.toThrow("A.md did not switch to live mode after 5 attempts (mode source, source true)");
        expect(attempts).toBe(5);
    });

    it("tells a path that is not in the vault", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(openFileInMode, () => ({ found: false }));
        await expect(helpers.openFile("Nope.md")).rejects.toThrow("Nope.md is not in the vault");
        await expect(helpers.openFile("Nope.md", { mode: "source" })).rejects.toThrow("not in the vault");
    });

    it("readingView opens the given note, or the active one, in reading view", async () => {
        const { fake, helpers } = setUp();
        const paths: string[] = [];
        fake.onEvaluate(openFileInMode, (arg) => {
            paths.push((arg as { path: string }).path);
            return { found: true, view: { mode: "preview", source: false } };
        });
        fake.onEvaluate(readActiveFilePath, () => "Active.md");
        await helpers.readingView("B.md");
        await helpers.readingView();
        expect(paths).toEqual(["B.md", "Active.md"]);
    });

    it("readingView without a path fails when no note is active", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(readActiveFilePath, () => null);
        await expect(helpers.readingView()).rejects.toThrow("no note is active");
    });
});

describe("editor", () => {
    const SELECTOR = '.workspace-leaf-content[data-type="markdown"] .cm-content[contenteditable=true]';

    it("types key by key and clicks first only when the editor is not focused", async () => {
        const { fake, helpers } = setUp();
        let focused = false;
        fake.onEvaluate(isFocusInside, () => {
            fake.log.push("focus check");
            return focused;
        });
        await helpers.editor().type("ab");
        focused = true;
        await helpers.editor().type("cd");
        // The editor is waited for before the focus is checked: right after a modal closes it may not be back yet.
        expect(fake.log).toEqual([
            `locator:${SELECTOR}`,
            `waitFor:${SELECTOR}:visible`,
            "focus check",
            `click:${SELECTOR}`,
            `pressSequentially:${SELECTOR}:ab:15`,
            `locator:${SELECTOR}`,
            `waitFor:${SELECTOR}:visible`,
            "focus check",
            `pressSequentially:${SELECTOR}:cd:15`,
        ]);
    });

    it("does not rely on the leaf being mod-active, which Obsidian drops while a modal is open", () => {
        expect(SELECTOR).not.toContain("mod-active");
    });

    it("says there is no editor when none appears, without clicking or typing", async () => {
        const { fake, helpers } = setUp();
        fake.failWaitFor(SELECTOR);
        await expect(helpers.editor().type("a")).rejects.toThrow(/There is no active editor.*No editor appeared within 555 ms/);
        expect(fake.log.filter((entry) => entry.startsWith("click") || entry.startsWith("pressSequentially"))).toEqual([]);
    });

    it("gives the typing a budget that grows with the text", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(isFocusInside, () => true);
        await helpers.editor().type("ab");
        // The ui budget plus 65 ms per key press: 15 ms of delay and 50 ms of slack.
        expect(fake.timeouts.find((entry) => entry.what.startsWith("pressSequentially"))?.timeout).toBe(555 + 2 * 65);
    });

    it("reads the text, and fails when there is no editor", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(readEditorText, () => "one\ntwo");
        expect(await helpers.editor().text()).toBe("one\ntwo");
        fake.onEvaluate(readEditorText, () => null);
        await expect(helpers.editor().text()).rejects.toThrow("There is no active editor");
    });

    it("clears with select-all and delete, then waits for an empty document", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(readEditorText, () => "something");
        fake.onEvaluate(isFocusInside, () => true);
        fake.onWait(isEditorEmpty, () => fake.log.push("empty"));
        await helpers.editor().clear();
        expect(fake.log.filter((entry) => !entry.startsWith("locator") && !entry.startsWith("waitFor"))).toEqual([
            "press:ControlOrMeta+A",
            "press:Delete",
            "empty",
        ]);
    });

    it("clear fails at once when there is no editor, instead of waiting for one", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(readEditorText, () => null);
        await expect(helpers.editor().clear()).rejects.toThrow("There is no active editor");
        expect(fake.log).toEqual([]);
    });

    it("clear says what to check when the document stays full", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(readEditorText, () => "something");
        fake.onEvaluate(isFocusInside, () => true);
        fake.onWait(isEditorEmpty, () => {
            throw new Error("Timeout");
        });
        await expect(helpers.editor().clear()).rejects.toThrow("not empty 555 ms after select-all and delete");
    });

    it("sets the cursor and refuses positions that are not integers from 0", async () => {
        const { fake, helpers } = setUp();
        const positions: unknown[] = [];
        fake.onEvaluate(placeEditorCursor, (position) => {
            positions.push(position);
            return true;
        });
        await helpers.editor().setCursor(2, 5);
        expect(positions).toEqual([{ line: 2, ch: 5 }]);
        for (const [line, ch] of [[-1, 0], [0, -1], [1.5, 0], [0, Number.NaN]] as const) {
            await expect(helpers.editor().setCursor(line, ch)).rejects.toThrow(RangeError);
        }
        expect(positions).toHaveLength(1);
        fake.onEvaluate(placeEditorCursor, () => false);
        await expect(helpers.editor().setCursor(0, 0)).rejects.toThrow("There is no active editor");
    });

    it("returns the selection, and fails when there is no editor", async () => {
        const { fake, helpers } = setUp();
        const selection = { text: "ell", anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 4 } };
        fake.onEvaluate(readEditorSelection, () => selection);
        expect(await helpers.editor().selection()).toEqual(selection);
        fake.onEvaluate(readEditorSelection, () => null);
        await expect(helpers.editor().selection()).rejects.toThrow("There is no active editor");
    });
});

/** A window where `compose()` works, so a CDP session gets opened. */
function composeSetUpFor(): ReturnType<typeof setUp> {
    const context = setUp();
    context.fake.onEvaluate(isFocusInside, () => true);
    context.fake.onEvaluate(readEditorText, () => "");
    context.fake.onWait(isEditorSettled, () => undefined);
    context.fake.onWait(editorTextChanged, () => undefined);
    return context;
}

describe("compose", () => {
    function composeSetUp(): ReturnType<typeof setUp> {
        const context = composeSetUpFor();
        context.fake.onWait(isEditorSettled, () => context.fake.log.push("settled"));
        context.fake.onWait(editorTextChanged, (before) => context.fake.log.push(`changed from ${JSON.stringify(before)}`));
        return context;
    }

    it("grows each word with imeSetComposition and commits it with insertText, waiting for CodeMirror in between", async () => {
        const { fake, helpers } = composeSetUp();
        await helpers.editor().compose("ab cd");
        expect(fake.cdp).toEqual([
            { method: "Input.imeSetComposition", params: { text: "a", selectionStart: 1, selectionEnd: 1 } },
            { method: "Input.imeSetComposition", params: { text: "ab", selectionStart: 2, selectionEnd: 2 } },
            { method: "Input.insertText", params: { text: "ab " } },
            { method: "Input.imeSetComposition", params: { text: "c", selectionStart: 1, selectionEnd: 1 } },
            { method: "Input.imeSetComposition", params: { text: "cd", selectionStart: 2, selectionEnd: 2 } },
            { method: "Input.insertText", params: { text: "cd" } },
        ]);
        expect(fake.log.filter((entry) => entry.startsWith("settled") || entry.startsWith("changed"))).toEqual(["settled", "settled", 'changed from ""']);
    });

    it("character chunking commits every character", async () => {
        const { fake, helpers } = composeSetUp();
        await helpers.editor().compose("ab", { chunking: "character" });
        expect(fake.cdp.filter((command) => command.method === "Input.insertText").map((command) => command.params)).toEqual([{ text: "a" }, { text: "b" }]);
    });

    it("opens one CDP session for all the compositions of a test and detaches it on dispose", async () => {
        const { fake, helpers, dispose } = composeSetUp();
        await helpers.editor().compose("a");
        await helpers.editor().compose("b");
        expect(fake.log.filter((entry) => entry === "newCDPSession")).toHaveLength(1);
        await dispose();
        expect(fake.log.at(-1)).toBe("cdp.detach");
    });

    it("clicks the editor first when focus is outside it, and does not when it is inside", async () => {
        const { fake, helpers } = composeSetUp();
        fake.onEvaluate(isFocusInside, () => false);
        await helpers.editor().compose("a");
        expect(fake.log.filter((entry) => entry.startsWith("click:"))).toHaveLength(1);
        // The click comes before the first composition event, so the composition lands where the click put the cursor.
        expect(fake.log.indexOf(fake.log.find((entry) => entry.startsWith("click:")) ?? "")).toBeLessThan(fake.log.indexOf("newCDPSession"));
        fake.log.length = 0;
        fake.onEvaluate(isFocusInside, () => true);
        await helpers.editor().compose("b");
        expect(fake.log.filter((entry) => entry.startsWith("click:"))).toEqual([]);
    });

    it("does nothing for an empty text", async () => {
        const { fake, helpers } = composeSetUp();
        await helpers.editor().compose("");
        expect(fake.cdp).toEqual([]);
        expect(fake.log).toEqual([]);
    });

    it("fails when CodeMirror stays in the composition", async () => {
        const { fake, helpers } = composeSetUp();
        fake.onWait(isEditorSettled, () => {
            throw new Error("Timeout");
        });
        await expect(helpers.editor().compose("a")).rejects.toThrow('still composing 333 ms after "a" was committed');
    });

    it("fails when the document did not change", async () => {
        const { fake, helpers } = composeSetUp();
        fake.onWait(editorTextChanged, () => {
            throw new Error("Timeout");
        });
        await expect(helpers.editor().compose("a")).rejects.toThrow("The document did not change within 333 ms after the composition");
    });

    it("fails before sending anything when there is no editor", async () => {
        const { fake, helpers } = composeSetUp();
        fake.onEvaluate(readEditorText, () => null);
        await expect(helpers.editor().compose("a")).rejects.toThrow("There is no active editor");
        expect(fake.cdp).toEqual([]);
    });
});

describe("dispose", () => {
    it("does nothing when no CDP session was opened", async () => {
        const { fake, dispose } = setUp();
        await dispose();
        expect(fake.log).toEqual([]);
    });

    it("does not touch a session whose window has closed", async () => {
        const { fake, dispose, helpers } = composeSetUpFor();
        await helpers.editor().compose("a");
        // The session exists: the test is about a closed window, not about having nothing to detach.
        expect(fake.log).toContain("newCDPSession");
        fake.closed = true;
        await dispose();
        expect(fake.log).not.toContain("cdp.detach");
    });

    it("detaches the session of a window that is still open", async () => {
        const { fake, dispose, helpers } = composeSetUpFor();
        await helpers.editor().compose("a");
        await dispose();
        expect(fake.log).toContain("cdp.detach");
    });
});

describe("appearance and state", () => {
    it("sets dark as obsidian, waits for the body class, and passes the theme through", async () => {
        const { fake, helpers } = setUp();
        const calls: unknown[] = [];
        fake.onEvaluate(applyTheme, (arg) => {
            calls.push(arg);
            return { ok: true };
        });
        let waitedFor: unknown;
        fake.onWait(isSchemeApplied, (scheme) => {
            waitedFor = scheme;
        });
        await helpers.setTheme({ mode: "dark" });
        await helpers.setTheme({ mode: "light", theme: "Minimal" });
        expect(calls).toEqual([
            { scheme: "obsidian", theme: null },
            { scheme: "moonstone", theme: "Minimal" },
        ]);
        expect(waitedFor).toBe("moonstone");
    });

    it("waits for the body class within the theme budget and says what to raise", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(applyTheme, () => ({ ok: true }));
        let given: unknown;
        fake.onWait(isSchemeApplied, (_scheme, options) => {
            given = options;
            throw new Error("Timeout");
        });
        await expect(helpers.setTheme({ mode: "dark" })).rejects.toThrow("did not get the dark theme class within 444 ms. Raise timeouts.helpers.theme");
        expect(given).toEqual({ polling: 50, timeout: 444 });
    });

    it("lists the installed themes when the named one is missing", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(applyTheme, () => ({ ok: false, themes: ["Minimal", "Things"] }));
        await expect(helpers.setTheme({ mode: "dark", theme: "Nope" })).rejects.toThrow('"Nope" is not installed. Installed community themes: Minimal, Things.');
        fake.onEvaluate(applyTheme, () => ({ ok: false, themes: [] }));
        await expect(helpers.setTheme({ mode: "dark", theme: "Nope" })).rejects.toThrow("Installed community themes: none.");
    });

    it("refuses a mode that is neither light nor dark", async () => {
        const { helpers } = setUp();
        await expect(helpers.setTheme({ mode: "sepia" as never })).rejects.toThrow('mode must be "light" or "dark", got "sepia"');
    });

    it("waits for the metadata cache and reports how far it got on a timeout", async () => {
        const { fake, helpers } = setUp();
        let options: unknown;
        fake.onWait(isMetadataCacheComplete, (_arg, given) => {
            options = given;
        });
        await helpers.waitForMetadataCache();
        expect(options).toEqual({ polling: 100, timeout: 222 });
        fake.onWait(isMetadataCacheComplete, () => {
            throw new Error("Timeout");
        });
        fake.onEvaluate(metadataCacheState, () => ({ total: 10, cached: 7 }));
        await expect(helpers.waitForMetadataCache()).rejects.toThrow(/indexed 7 of 10 markdown files after 222 ms.*timeouts\.helpers\.metadataCache/);
    });

    it("clears notices and reports the count, hides properties, scrolls", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(removeNotices, () => 2);
        fake.onEvaluate(hideNoteProperties, () => fake.log.push("hidden"));
        const selectors: unknown[] = [];
        fake.onEvaluate(scrollThroughElement, (selector) => {
            selectors.push(selector);
            return true;
        });
        expect(await helpers.clearNotices()).toBe(2);
        await helpers.hideProperties();
        await helpers.scrollThrough();
        await helpers.scrollThrough(".custom");
        expect(fake.log).toEqual(["hidden"]);
        expect(selectors).toEqual([".workspace-leaf.mod-active .markdown-preview-view", ".custom"]);
    });

    it("scrollThrough fails when nothing matches", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(scrollThroughElement, () => false);
        await expect(helpers.scrollThrough(".nope")).rejects.toThrow('nothing matches ".nope"');
    });
});

describe("collapseSidebars and expandSidebars", () => {
    it("collapses, then waits until both panels report collapsed, with the ui budget", async () => {
        const { fake, helpers } = setUp();
        const wanted: unknown[] = [];
        fake.onEvaluate(setSidebarsCollapsed, (collapsed) => {
            fake.log.push(`set:${String(collapsed)}`);
            return true;
        });
        fake.onWait(areSidebarsCollapsed, (collapsed, options) => {
            wanted.push([collapsed, options]);
        });
        await helpers.collapseSidebars();
        expect(fake.log).toEqual(["set:true"]);
        expect(wanted).toEqual([[true, { polling: 50, timeout: 555 }]]);
    });

    it("expands and waits for the expanded state", async () => {
        const { fake, helpers } = setUp();
        const wanted: unknown[] = [];
        fake.onEvaluate(setSidebarsCollapsed, () => true);
        fake.onWait(areSidebarsCollapsed, (collapsed) => {
            wanted.push(collapsed);
        });
        await helpers.expandSidebars();
        expect(wanted).toEqual([false]);
    });

    it("fails with the helper's name when this Obsidian has no side panels to drive", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(setSidebarsCollapsed, () => false);
        await expect(helpers.collapseSidebars()).rejects.toThrow("collapseSidebars(): this Obsidian has no workspace.leftSplit");
        await expect(helpers.expandSidebars()).rejects.toThrow("expandSidebars(): this Obsidian has no workspace.leftSplit");
    });

    it("names the budget when a panel stays in the old state", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(setSidebarsCollapsed, () => true);
        fake.onWait(areSidebarsCollapsed, () => {
            throw new Error("Timeout");
        });
        await expect(helpers.collapseSidebars()).rejects.toThrow(/not collapsed 555 ms after collapseSidebars\(\).*timeouts\.helpers\.ui/);
    });
});

describe("mobile and desktop", () => {
    function mobileSetUp(startsMobile: boolean): ReturnType<typeof setUp> & { state: { mobile: boolean; reloads: number } } {
        const context = setUp(12_345);
        const state = { mobile: startsMobile, reloads: 0 };
        const { fake } = context;
        fake.onWait(hasInnerWidth, (width, options) => fake.log.push(`width:${String(width)}:${JSON.stringify(options)}`));
        fake.onEvaluate(isMobileApplied, (on) => state.mobile === on);
        fake.onEvaluate(enabledPluginIds, () => ["p1", "p2"]);
        fake.onEvaluate(markBeforeReload, () => fake.log.push("marked"));
        fake.onEvaluate(switchMobileEmulation, (on) => {
            fake.log.push(`switch:${String(on)}`);
            state.mobile = on === true;
            state.reloads += 1;
            return Promise.reject(new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation"));
        });
        fake.onWait(isReloaded, (_arg, options) => fake.log.push(`reloaded:${JSON.stringify(options)}`));
        fake.onWait(isReady, (ids, options) => fake.log.push(`ready:${JSON.stringify(ids)}:${JSON.stringify(options)}`));
        fake.onWait(isMobileApplied, (on) => fake.log.push(`body:${String(on)}`));
        return { ...context, state };
    }

    it("sets the phone size, switches, waits for the reload and every plugin, and sets the size again", async () => {
        const { fake, helpers } = mobileSetUp(false);
        await helpers.mobile();
        const metrics = { width: 390, height: 844, deviceScaleFactor: 2, mobile: false };
        expect(fake.cdp).toEqual([
            { method: "Emulation.setDeviceMetricsOverride", params: metrics },
            { method: "Emulation.setDeviceMetricsOverride", params: metrics },
        ]);
        // The size is set and waited for before the switch (the layout is decided at load), and again after it.
        expect(fake.log).toEqual([
            "newCDPSession",
            'width:390:{"polling":50,"timeout":5000}',
            "marked",
            "switch:true",
            'reloaded:{"polling":50,"timeout":12345}',
            'ready:["p1","p2"]:{"polling":50,"timeout":12345}',
            "body:true",
            'width:390:{"polling":50,"timeout":5000}',
        ]);
    });

    it("waits for the width after each override and says what to check when it never comes", async () => {
        const { fake, helpers } = mobileSetUp(false);
        fake.onWait(hasInnerWidth, () => {
            throw new Error("Timeout");
        });
        await expect(helpers.mobile()).rejects.toThrow("window width did not become 390 within 5000 ms");
        expect(fake.log).not.toContain("switch:true");
    });

    it("names the wait and the option when the window does not reload", async () => {
        const { fake, helpers } = mobileSetUp(false);
        fake.onWait(isReloaded, () => {
            throw new Error("Timeout");
        });
        await expect(helpers.mobile()).rejects.toThrow("did not reload within 12345 ms after the mobile emulation was switched on. Raise timeouts.ready");
    });

    it("says so when the reloaded window lacks the is-mobile class", async () => {
        const { fake, helpers } = mobileSetUp(false);
        fake.onWait(isMobileApplied, () => {
            throw new Error("Timeout");
        });
        await expect(helpers.mobile()).rejects.toThrow("lacks the is-mobile class after 5000 ms");
    });

    it("takes the size from the options", async () => {
        const { fake, helpers } = mobileSetUp(false);
        await helpers.mobile({ width: 360, height: 640, scale: 3 });
        expect(fake.cdp[0]?.params).toEqual({ width: 360, height: 640, deviceScaleFactor: 3, mobile: false });
    });

    it("does not reload for a second call with the same size, but sets the size", async () => {
        const { fake, helpers, state } = mobileSetUp(false);
        await helpers.mobile({ width: 800 });
        await helpers.mobile({ width: 800, height: 600 });
        expect(state.reloads).toBe(1);
        expect(fake.cdp).toHaveLength(4);
    });

    it("reloads again for a second call with another width, so the phone or tablet layout follows the size", async () => {
        const { fake, helpers, state } = mobileSetUp(false);
        await helpers.mobile({ width: 800 });
        await helpers.mobile();
        expect(state.reloads).toBe(2);
        expect(fake.cdp.map((command) => (command.params as { width: number }).width)).toEqual([800, 800, 390, 390]);
    });

    it("reloads a window that was mobile before this helper set its size, because its layout is not known", async () => {
        const { state, helpers } = mobileSetUp(true);
        await helpers.mobile();
        expect(state.reloads).toBe(1);
    });

    it("after desktop(), the next mobile() reloads even for the same size", async () => {
        const { state, helpers } = mobileSetUp(false);
        await helpers.mobile();
        await helpers.desktop();
        await helpers.mobile();
        expect(state.reloads).toBe(3);
    });

    it("rejects a size that cannot be a screen before touching the window", async () => {
        const { fake, helpers } = mobileSetUp(false);
        await expect(helpers.mobile({ width: 0 })).rejects.toThrow("width must be a positive number");
        expect(fake.log).toEqual([]);
    });

    it("lets a real failure of emulateMobile through", async () => {
        const { fake, helpers } = mobileSetUp(false);
        fake.onEvaluate(switchMobileEmulation, () => Promise.reject(new TypeError("app.emulateMobile is not a function")));
        await expect(helpers.mobile()).rejects.toThrow("app.emulateMobile is not a function");
    });

    it("accepts an emulateMobile call that returns normally", async () => {
        const { fake, helpers } = mobileSetUp(false);
        fake.onEvaluate(switchMobileEmulation, () => undefined);
        await expect(helpers.mobile()).resolves.toBeUndefined();
    });

    it("desktop switches back, waits for every plugin and clears the override", async () => {
        const { fake, helpers } = mobileSetUp(true);
        await helpers.desktop();
        expect(fake.log).toContain("switch:false");
        expect(fake.log).toContain('ready:["p1","p2"]:{"polling":50,"timeout":12345}');
        expect(fake.log).toContain("body:false");
        expect(fake.cdp).toEqual([{ method: "Emulation.clearDeviceMetricsOverride", params: undefined }]);
    });

    it("desktop on a desktop window only clears the override", async () => {
        const { fake, helpers, state } = mobileSetUp(false);
        await helpers.desktop();
        expect(state.reloads).toBe(0);
        expect(fake.cdp).toHaveLength(1);
    });
});

describe("replace", () => {
    it("installs the factory source and its argument under a fresh id and returns the calls", async () => {
        const { fake, helpers } = setUp();
        let installed: unknown;
        fake.onEvaluate(installFake, (arg) => {
            installed = arg;
            return { ok: true };
        });
        fake.onEvaluate(readFakeCalls, () => [["a"], ["b"]]);
        const handle = await helpers.replace("my-plugin", "http", (prefix: string) => (request: string) => `${prefix} ${request}`, "fake");
        expect(installed).toEqual({
            id: "opdk-fake-1",
            pluginId: "my-plugin",
            path: "http",
            source: "(prefix) => (request) => `${prefix} ${request}`",
            arg: "fake",
        });
        expect(await handle.calls()).toEqual([["a"], ["b"]]);
        await helpers.replace("my-plugin", "http", () => () => 1).catch(() => undefined);
        expect((installed as { id: string }).id).toBe("opdk-fake-2");
    });

    it("hands over a structured argument unchanged, and none when it is left out", async () => {
        const { fake, helpers } = setUp();
        const seen: unknown[] = [];
        fake.onEvaluate(installFake, (arg) => {
            seen.push((arg as { arg: unknown }).arg);
            return { ok: true };
        });
        await helpers.replace("p", "t", (config: { days: number; mode: string }) => () => config, { days: 7, mode: "ok" });
        await helpers.replace("p", "t", () => () => 1);
        expect(seen).toEqual([{ days: 7, mode: "ok" }, undefined]);
    });

    it("fails with the reason from the page", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(installFake, () => ({ ok: false, reason: 'plugin "x" is not loaded (loaded: none)' }));
        await expect(helpers.replace("x", "http", () => () => 1)).rejects.toThrow('replace(x, http): plugin "x" is not loaded (loaded: none).');
    });

    it("restore puts the original back once, and calls stay readable afterwards", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(installFake, () => ({ ok: true }));
        let reads = 0;
        fake.onEvaluate(readFakeCalls, () => {
            reads += 1;
            return [["x"]];
        });
        let removed = 0;
        fake.onEvaluate(removeFake, () => {
            removed += 1;
            return true;
        });
        const handle = await helpers.replace("p", "t", () => () => 1);
        await handle.restore();
        await handle.restore();
        expect(removed).toBe(1);
        expect(await handle.calls()).toEqual([["x"]]);
        expect(reads).toBe(1);
    });

    it("calls() and restore() explain a record that is gone after a reload", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(installFake, () => ({ ok: true }));
        fake.onEvaluate(readFakeCalls, () => null);
        const handle = await helpers.replace("p", "t", () => () => 1);
        await expect(handle.calls()).rejects.toThrow("window was reloaded since replace()");
        await expect(handle.restore()).rejects.toThrow("window was reloaded since replace()");
    });
});

describe("evaluate", () => {
    it("sends the function as source text with its argument and returns the value", async () => {
        const { fake, helpers } = setUp();
        let sent: unknown;
        fake.onEvaluate(runWithApp, (arg) => {
            sent = arg;
            return { ok: true, value: 7 };
        });
        const count: number = await helpers.evaluate((app: { n: number }, extra: number) => app.n + extra, 4);
        expect(count).toBe(7);
        expect(sent).toEqual({ source: "(app, extra) => app.n + extra", arg: 4 });
    });

    it("works without an argument and returns what the promise resolves to", async () => {
        const { fake, helpers } = setUp();
        let sent: unknown;
        fake.onEvaluate(runWithApp, (arg) => {
            sent = arg;
            return { ok: true, value: "done" };
        });
        const value: string = await helpers.evaluate((): Promise<string> => Promise.resolve("done"));
        expect(value).toBe("done");
        expect(sent).toEqual({ source: '() => Promise.resolve("done")', arg: undefined });
    });

    it("fails with the reason from the page and says how to pass variables", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(runWithApp, () => ({ ok: false, reason: "window.app is not defined yet" }));
        await expect(helpers.evaluate(() => 1)).rejects.toThrow(/evaluate\(\): window\.app is not defined yet\..*second argument/);
    });

    it("lets an exception from the page through", async () => {
        const { fake, helpers } = setUp();
        fake.onEvaluate(runWithApp, () => {
            throw new Error("boom in page");
        });
        await expect(helpers.evaluate(() => 1)).rejects.toThrow("boom in page");
    });
});

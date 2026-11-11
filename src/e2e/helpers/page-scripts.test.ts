import { afterEach, describe, expect, it, vi } from "vitest";
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
    reloadApp,
    removeFake,
    removeNotices,
    runCommandById,
    runWithApp,
    saveWorkspaceLayout,
    scrollThroughElement,
    setSidebarsCollapsed,
    switchMobileEmulation,
} from "./page-scripts.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

function stubEditor(initial = "hello"): { value: string; editor: Record<string, unknown>; cursor: unknown[]; focused: number } {
    const state = { value: initial, cursor: [] as unknown[], focused: 0, editor: {} as Record<string, unknown> };
    state.editor = {
        getValue: () => state.value,
        getSelection: () => "ell",
        listSelections: () => [{ anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 4 } }],
        setCursor: (position: unknown) => state.cursor.push(position),
        focus: () => (state.focused += 1),
        cm: { composing: false },
    };
    vi.stubGlobal("app", { workspace: { activeEditor: { editor: state.editor } } });
    return state;
}

describe("settings scripts", () => {
    it("finds a tab in pluginTabs or settingTabs and lists both", () => {
        vi.stubGlobal("app", { setting: { pluginTabs: [{ id: "my-plugin" }], settingTabs: [{ id: "editor" }] } });
        expect(hasSettingTab("my-plugin")).toBe(true);
        expect(hasSettingTab("editor")).toBe(true);
        expect(hasSettingTab("nope")).toBe(false);
        expect(listSettingTabIds()).toEqual(["editor", "my-plugin"]);
    });

    it("copes with an app that has no settings yet", () => {
        vi.stubGlobal("app", {});
        expect(hasSettingTab("x")).toBe(false);
        expect(listSettingTabIds()).toEqual([]);
        expect(() => {
            openSettingsModal("x");
            closeSettingsModal();
        }).not.toThrow();
    });

    it("opens the modal, and the tab only when an id is given", () => {
        const setting = { open: vi.fn(), openTabById: vi.fn(), close: vi.fn() };
        vi.stubGlobal("app", { setting });
        openSettingsModal(null);
        expect(setting.open).toHaveBeenCalledOnce();
        expect(setting.openTabById).not.toHaveBeenCalled();
        openSettingsModal("editor");
        expect(setting.openTabById).toHaveBeenCalledWith("editor");
        closeSettingsModal();
        expect(setting.close).toHaveBeenCalledOnce();
    });

    it("does not open a second modal when Settings is open already, but still switches the tab", () => {
        const setting = { open: vi.fn(), openTabById: vi.fn() };
        vi.stubGlobal("app", { setting });
        vi.stubGlobal("document", { querySelector: (selector: string) => (selector === ".modal.mod-settings" ? {} : null) });
        openSettingsModal("editor");
        expect(setting.open).not.toHaveBeenCalled();
        expect(setting.openTabById).toHaveBeenCalledWith("editor");
        vi.stubGlobal("document", { querySelector: () => null });
        openSettingsModal("editor");
        expect(setting.open).toHaveBeenCalledOnce();
    });
});

describe("runCommandById", () => {
    it("reports a missing id with every registered id", () => {
        vi.stubGlobal("app", { commands: { commands: { "a:b": {}, "c:d": {} }, executeCommandById: vi.fn() } });
        expect(runCommandById("a:x")).toEqual({ state: "missing", ids: ["a:b", "c:d"] });
    });

    it("reports a command whose checkCallback declines, without running it", () => {
        // Obsidian 1.14.5 answers true from executeCommandById even then, so the check-only call decides.
        const execute = vi.fn(() => true);
        const checkCallback = vi.fn(() => false);
        vi.stubGlobal("app", { commands: { commands: { "a:b": { checkCallback } }, executeCommandById: execute } });
        expect(runCommandById("a:b")).toEqual({ state: "declined" });
        expect(checkCallback).toHaveBeenCalledWith(true);
        expect(execute).not.toHaveBeenCalled();
    });

    it("runs a command whose checkCallback accepts", () => {
        const execute = vi.fn(() => true);
        vi.stubGlobal("app", { commands: { commands: { "a:b": { checkCallback: () => true } }, executeCommandById: execute } });
        expect(runCommandById("a:b")).toEqual({ state: "ran" });
        expect(execute).toHaveBeenCalledWith("a:b");
    });

    it("reports a known id that executeCommandById refuses as declined", () => {
        vi.stubGlobal("app", { commands: { commands: { "a:b": {} }, executeCommandById: () => false } });
        expect(runCommandById("a:b")).toEqual({ state: "declined" });
    });

    it("runs a command through executeCommandById", () => {
        const execute = vi.fn(() => true);
        vi.stubGlobal("app", { commands: { commands: { "a:b": {} }, executeCommandById: execute } });
        expect(runCommandById("a:b")).toEqual({ state: "ran" });
        expect(execute).toHaveBeenCalledWith("a:b");
    });

    it("treats an app without commands as having none", () => {
        vi.stubGlobal("app", {});
        expect(runCommandById("a:b")).toEqual({ state: "missing", ids: [] });
    });
});

describe("page script results", () => {
    // A page function that returns a live Obsidian object fails with "Attempting to serialize unexpected value".
    it("are plain data that survives a structured clone", async () => {
        const plugin = { transport: (value: string) => `real:${value}` };
        vi.stubGlobal("app", {
            commands: { commands: { "a:b": {} }, executeCommandById: () => true },
            plugins: { plugins: { p: plugin } },
        });
        vi.stubGlobal("document", { querySelector: () => null });
        const results = [
            runCommandById("a:b"),
            runCommandById("a:missing"),
            installFake({ id: "f", pluginId: "p", path: "transport", source: "() => function () { return 1; }" }),
            readFakeCalls("f"),
            removeFake("f"),
            await scrollThroughElement(".none"),
        ];
        expect(structuredClone(results)).toEqual(results);
    });
});

describe("openFileInMode", () => {
    function stubWorkspace(viewState: Record<string, unknown>, options: { ignoreSetState?: boolean } = {}): {
        openFile: ReturnType<typeof vi.fn>;
        setState: ReturnType<typeof vi.fn>;
        setActiveLeaf: ReturnType<typeof vi.fn>;
    } {
        let state = viewState;
        const setState = vi.fn((next: Record<string, unknown>) => {
            if (options.ignoreSetState !== true) {
                state = next;
            }
            return Promise.resolve();
        });
        const openFile = vi.fn(() => Promise.resolve());
        const leaf = { view: { getState: () => state, setState }, openFile };
        const setActiveLeaf = vi.fn();
        vi.stubGlobal("app", {
            vault: { getAbstractFileByPath: (path: string) => (path === "A.md" ? { extension: "md" } : path === "Folder" ? {} : null) },
            workspace: { getLeaf: () => leaf, setActiveLeaf },
        });
        return { openFile, setState, setActiveLeaf };
    }

    it("reports a path that is not a file", async () => {
        stubWorkspace({ mode: "source" });
        expect(await openFileInMode({ path: "nope.md", wanted: null })).toEqual({ found: false });
        expect(await openFileInMode({ path: "Folder", wanted: null })).toEqual({ found: false });
    });

    it("opens without forcing a mode when none is wanted", async () => {
        const { openFile, setState, setActiveLeaf } = stubWorkspace({ mode: "preview" });
        expect(await openFileInMode({ path: "A.md", wanted: null })).toEqual({ found: true, view: { mode: "preview", source: false } });
        expect(openFile).toHaveBeenCalledWith({ extension: "md" }, { active: true });
        expect(setState).not.toHaveBeenCalled();
        expect(setActiveLeaf).toHaveBeenCalledWith(expect.anything(), { focus: true });
    });

    it("passes the wanted state to openFile and leaves a view that already matches alone", async () => {
        const { openFile, setState } = stubWorkspace({ mode: "source", source: true });
        const result = await openFileInMode({ path: "A.md", wanted: { mode: "source", source: true } });
        expect(result).toEqual({ found: true, view: { mode: "source", source: true } });
        expect(openFile).toHaveBeenCalledWith(expect.anything(), { active: true, state: { mode: "source", source: true } });
        expect(setState).not.toHaveBeenCalled();
    });

    it("sets the view state when the note was already open in another mode, keeping the rest of the state", async () => {
        const { setState } = stubWorkspace({ mode: "source", source: true, file: "A.md" });
        const result = await openFileInMode({ path: "A.md", wanted: { mode: "preview", source: false } });
        expect(setState).toHaveBeenCalledWith({ mode: "preview", source: false, file: "A.md" }, { history: false });
        expect(result).toEqual({ found: true, view: { mode: "preview", source: false } });
    });

    it("distinguishes live preview from source by the flag", async () => {
        const { setState } = stubWorkspace({ mode: "source", source: true });
        await openFileInMode({ path: "A.md", wanted: { mode: "source", source: false } });
        expect(setState).toHaveBeenCalledOnce();
    });

    it("returns what the view ended up in when the set is ignored", async () => {
        stubWorkspace({ mode: "source", source: true }, { ignoreSetState: true });
        const result = await openFileInMode({ path: "A.md", wanted: { mode: "preview", source: false } });
        expect(result).toEqual({ found: true, view: { mode: "source", source: true } });
    });

    it("returns no view state for a view that has none (not a markdown view)", async () => {
        const leaf = { view: {}, openFile: () => Promise.resolve() };
        vi.stubGlobal("app", { vault: { getAbstractFileByPath: () => ({ extension: "png" }) }, workspace: { getLeaf: () => leaf } });
        expect(await openFileInMode({ path: "a.png", wanted: { mode: "preview", source: false } })).toEqual({ found: true, view: null });
    });

    it("reports not found when the app has no workspace", async () => {
        vi.stubGlobal("app", {});
        expect(await openFileInMode({ path: "A.md", wanted: null })).toEqual({ found: false });
    });
});

describe("editor scripts", () => {
    it("reads the text, the selection and the active file", () => {
        stubEditor("one\ntwo");
        expect(readEditorText()).toBe("one\ntwo");
        expect(readEditorSelection()).toEqual({ text: "ell", anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 4 } });
    });

    it("answers null when there is no editor", () => {
        vi.stubGlobal("app", { workspace: { activeEditor: null, getActiveFile: () => null } });
        expect(readEditorText()).toBeNull();
        expect(readEditorSelection()).toBeNull();
        expect(readActiveFilePath()).toBeNull();
        expect(placeEditorCursor({ line: 0, ch: 0 })).toBe(false);
        expect(isEditorEmpty()).toBe(false);
        expect(editorTextChanged("x")).toBe(false);
    });

    it("answers null for a selection list that is empty", () => {
        vi.stubGlobal("app", { workspace: { activeEditor: { editor: { listSelections: () => [] } } } });
        expect(readEditorSelection()).toBeNull();
    });

    it("reads the active file path", () => {
        vi.stubGlobal("app", { workspace: { getActiveFile: () => ({ path: "Notes/A.md" }) } });
        expect(readActiveFilePath()).toBe("Notes/A.md");
    });

    it("focuses and places the cursor", () => {
        const state = stubEditor();
        expect(placeEditorCursor({ line: 2, ch: 3 })).toBe(true);
        expect(state.focused).toBe(1);
        expect(state.cursor).toEqual([{ line: 2, ch: 3 }]);
    });

    it("knows when the document is empty or changed", () => {
        const state = stubEditor("");
        expect(isEditorEmpty()).toBe(true);
        expect(editorTextChanged("")).toBe(false);
        state.value = "x";
        expect(isEditorEmpty()).toBe(false);
        expect(editorTextChanged("")).toBe(true);
    });

    it("is settled unless CodeMirror reports a composition", () => {
        const state = stubEditor();
        expect(isEditorSettled()).toBe(true);
        (state.editor.cm as { composing: boolean }).composing = true;
        expect(isEditorSettled()).toBe(false);
        vi.stubGlobal("app", { workspace: { activeEditor: { editor: { getValue: () => "" } } } });
        expect(isEditorSettled()).toBe(true);
    });

    it("tells whether focus is inside the element", () => {
        const inside = { contains: (other: unknown) => other === "active" };
        vi.stubGlobal("document", { activeElement: "active", querySelector: (selector: string) => (selector === ".cm" ? inside : null) });
        expect(isFocusInside(".cm")).toBe(true);
        expect(isFocusInside(".other")).toBe(false);
        vi.stubGlobal("document", { activeElement: "elsewhere", querySelector: () => inside });
        expect(isFocusInside(".cm")).toBe(false);
    });
});

describe("appearance and state scripts", () => {
    it("sets the scheme through changeTheme, setConfig and a css-change event, and leaves the theme alone", () => {
        const app = { changeTheme: vi.fn(), vault: { setConfig: vi.fn() }, workspace: { trigger: vi.fn() }, customCss: { setTheme: vi.fn(), themes: {} } };
        vi.stubGlobal("app", app);
        expect(applyTheme({ scheme: "obsidian", theme: null })).toEqual({ ok: true });
        expect(app.changeTheme).toHaveBeenCalledWith("obsidian");
        expect(app.vault.setConfig).toHaveBeenCalledWith("theme", "obsidian");
        expect(app.workspace.trigger).toHaveBeenCalledWith("css-change");
        expect(app.customCss.setTheme).not.toHaveBeenCalled();
    });

    it("sets an installed community theme, and the default one for an empty name", () => {
        const app = { customCss: { setTheme: vi.fn(), themes: { Minimal: {} } } };
        vi.stubGlobal("app", app);
        expect(applyTheme({ scheme: "moonstone", theme: "Minimal" })).toEqual({ ok: true });
        expect(app.customCss.setTheme).toHaveBeenLastCalledWith("Minimal");
        expect(applyTheme({ scheme: "moonstone", theme: "" })).toEqual({ ok: true });
        expect(app.customCss.setTheme).toHaveBeenLastCalledWith("");
    });

    it("refuses a theme that is not installed and changes nothing", () => {
        const app = { changeTheme: vi.fn(), customCss: { setTheme: vi.fn(), themes: { Minimal: {} } } };
        vi.stubGlobal("app", app);
        expect(applyTheme({ scheme: "obsidian", theme: "Nope" })).toEqual({ ok: false, themes: ["Minimal"] });
        expect(app.changeTheme).not.toHaveBeenCalled();
    });

    it("reads the colour scheme from the body class", () => {
        const body = (classes: string[]): object => ({ classList: { contains: (name: string) => classes.includes(name) } });
        vi.stubGlobal("document", { body: body(["theme-dark"]) });
        expect(isSchemeApplied("obsidian")).toBe(true);
        expect(isSchemeApplied("moonstone")).toBe(false);
        vi.stubGlobal("document", { body: body(["theme-light"]) });
        expect(isSchemeApplied("moonstone")).toBe(true);
    });

    it("counts cached markdown files and is complete only when all are cached", () => {
        const files = ["a", "b", "c"];
        const cache = new Set(["a", "b"]);
        vi.stubGlobal("app", { vault: { getMarkdownFiles: () => files }, metadataCache: { getFileCache: (file: string) => (cache.has(file) ? {} : null) } });
        expect(metadataCacheState()).toEqual({ total: 3, cached: 2 });
        expect(isMetadataCacheComplete()).toBe(false);
        cache.add("c");
        expect(metadataCacheState()).toEqual({ total: 3, cached: 3 });
        expect(isMetadataCacheComplete()).toBe(true);
    });

    it("is complete at once for a vault without markdown files, instead of waiting for files that never come", () => {
        vi.stubGlobal("app", { vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => null } });
        expect(isMetadataCacheComplete()).toBe(true);
        expect(metadataCacheState()).toEqual({ total: 0, cached: 0 });
    });

    it("removes every notice and returns how many", () => {
        const notices = [{ remove: vi.fn() }, { remove: vi.fn() }];
        vi.stubGlobal("document", { querySelectorAll: (selector: string) => (selector === ".notice" ? notices : []) });
        expect(removeNotices()).toBe(2);
        expect(notices.every((notice) => notice.remove.mock.calls.length === 1)).toBe(true);
        vi.stubGlobal("document", { querySelectorAll: () => [] });
        expect(removeNotices()).toBe(0);
    });

    it("hides properties through the vault config and reads config back", () => {
        const config = new Map<string, unknown>();
        vi.stubGlobal("app", { vault: { setConfig: (k: string, v: unknown) => config.set(k, v), getConfig: (k: string) => config.get(k) } });
        hideNoteProperties();
        expect(readConfig("propertiesInDocument")).toBe("hidden");
    });
});

describe("sidebar scripts", () => {
    function stubSplits(options: { collapsed?: boolean } = {}): { left: Record<string, unknown>; right: Record<string, unknown>; calls: string[] } {
        const calls: string[] = [];
        const split = (name: string): Record<string, unknown> => {
            const state: Record<string, unknown> = { collapsed: options.collapsed ?? false };
            state.collapse = () => {
                calls.push(`${name}:collapse`);
                state.collapsed = true;
            };
            state.expand = () => {
                calls.push(`${name}:expand`);
                state.collapsed = false;
            };
            return state;
        };
        const left = split("left");
        const right = split("right");
        vi.stubGlobal("app", { workspace: { leftSplit: left, rightSplit: right } });
        return { left, right, calls };
    }

    it("collapses and expands both panels", () => {
        const { left, right, calls } = stubSplits();
        expect(setSidebarsCollapsed(true)).toBe(true);
        expect([left.collapsed, right.collapsed]).toEqual([true, true]);
        expect(setSidebarsCollapsed(false)).toBe(true);
        expect([left.collapsed, right.collapsed]).toEqual([false, false]);
        expect(calls).toEqual(["left:collapse", "right:collapse", "left:expand", "right:expand"]);
    });

    it("reports a missing split without touching the other", () => {
        const calls: string[] = [];
        vi.stubGlobal("app", { workspace: { leftSplit: { collapse: () => calls.push("collapse"), expand: () => calls.push("expand") } } });
        expect(setSidebarsCollapsed(true)).toBe(false);
        expect(calls).toEqual([]);
        vi.stubGlobal("app", {});
        expect(setSidebarsCollapsed(true)).toBe(false);
    });

    it("saves the workspace layout at once, and does nothing without saveLayout()", async () => {
        const saveLayout = vi.fn(() => Promise.resolve());
        vi.stubGlobal("app", { workspace: { saveLayout } });
        await saveWorkspaceLayout();
        expect(saveLayout).toHaveBeenCalledTimes(1);
        vi.stubGlobal("app", { workspace: {} });
        await expect(saveWorkspaceLayout()).resolves.toBeUndefined();
        vi.stubGlobal("app", {});
        await expect(saveWorkspaceLayout()).resolves.toBeUndefined();
    });

    it("sees the wanted state only when both panels are in it", () => {
        const { left, right } = stubSplits({ collapsed: true });
        expect(areSidebarsCollapsed(true)).toBe(true);
        expect(areSidebarsCollapsed(false)).toBe(false);
        right.collapsed = false;
        expect(areSidebarsCollapsed(true)).toBe(false);
        left.collapsed = false;
        expect(areSidebarsCollapsed(false)).toBe(true);
    });

    it("is not satisfied while the panels are missing", () => {
        vi.stubGlobal("app", { workspace: {} });
        expect(areSidebarsCollapsed(true)).toBe(false);
        expect(areSidebarsCollapsed(false)).toBe(false);
    });
});

describe("scrollThroughElement", () => {
    function stubScroller(options: { grows?: boolean } = {}): { root: { scrollTop: number; scrollHeight: number; clientHeight: number }; tops: number[] } {
        const tops: number[] = [];
        let top = 0;
        const root = {
            get scrollTop(): number {
                return top;
            },
            set scrollTop(value: number) {
                top = value;
                tops.push(value);
                // Drawing a block at the bottom makes the note longer, once.
                if (options.grows === true && value >= 600 && root.scrollHeight === 1000) {
                    root.scrollHeight = 1500;
                }
            },
            scrollHeight: 1000,
            clientHeight: 400,
        };
        vi.stubGlobal("document", { querySelector: (selector: string) => (selector === ".view" ? root : null) });
        vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
            queueMicrotask(callback);
            return 1;
        });
        return { root, tops };
    }

    it("returns false when nothing matches", async () => {
        stubScroller();
        expect(await scrollThroughElement(".nothing")).toBe(false);
    });

    it("steps to the bottom and stays there", async () => {
        const { tops } = stubScroller();
        expect(await scrollThroughElement(".view")).toBe(true);
        // clientHeight 400 gives steps of 300: 0, 300, 600, and 600 is the last (1000 - 400).
        expect(tops).toEqual([0, 300, 600]);
    });

    it("follows a note that grows while it scrolls", async () => {
        const { tops } = stubScroller({ grows: true });
        await scrollThroughElement(".view");
        expect(Math.max(...tops)).toBe(1200);
        expect(tops.at(-1)).toBe(1200);
    });

    it("falls back to a timer when the window runs no animation frames", async () => {
        stubScroller();
        vi.stubGlobal("requestAnimationFrame", undefined);
        vi.useFakeTimers();
        try {
            const done = scrollThroughElement(".view");
            await vi.runAllTimersAsync();
            expect(await done).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("runWithApp", () => {
    it("calls the function with window.app and the argument and returns the value", async () => {
        vi.stubGlobal("app", { name: "the app" });
        const result = await runWithApp({ source: "(app, arg) => app.name + ':' + arg.n", arg: { n: 3 } });
        expect(result).toEqual({ ok: true, value: "the app:3" });
    });

    it("awaits an async function and accepts a function expression", async () => {
        vi.stubGlobal("app", { files: ["a", "b"] });
        const result = await runWithApp({ source: "async function (app) { return app.files.length; }" });
        expect(result).toEqual({ ok: true, value: 2 });
    });

    it("passes undefined when there is no argument", async () => {
        vi.stubGlobal("app", {});
        expect(await runWithApp({ source: "(app, arg) => arg === undefined" })).toEqual({ ok: true, value: true });
    });

    it("rebuilds the function in the global scope, so it cannot see the locals of runWithApp", async () => {
        vi.stubGlobal("app", {});
        // A direct eval would see `args` and `app` of runWithApp; an indirect one sees only globals.
        expect(await runWithApp({ source: "() => typeof args" })).toEqual({ ok: true, value: "undefined" });
        expect(await runWithApp({ source: "() => typeof fn" })).toEqual({ ok: true, value: "undefined" });
    });

    it("refuses when window.app is missing", async () => {
        vi.stubGlobal("app", undefined);
        expect(await runWithApp({ source: "() => 1" })).toEqual({ ok: false, reason: "window.app is not defined yet" });
    });

    it("refuses source that is not a function, and source that does not parse", async () => {
        vi.stubGlobal("app", {});
        const reasonOf = async (source: string): Promise<string> => {
            const result = await runWithApp({ source });
            return result.ok ? "ran" : result.reason;
        };
        expect(await reasonOf("42")).toContain("not a function");
        expect(await reasonOf("run() { return 1; }")).toContain("could not be rebuilt");
    });

    it("lets an exception of the function itself through", async () => {
        vi.stubGlobal("app", {});
        await expect(runWithApp({ source: "() => { throw new Error('boom'); }" })).rejects.toThrow("boom");
    });
});

describe("fake scripts", () => {
    function stubPlugin(): { plugin: { transport: (value: string) => string; nested: { call: () => string } }; seen: unknown[] } {
        const plugin = { transport: (value: string) => `real:${value}`, nested: { call: () => "real" } };
        vi.stubGlobal("app", { plugins: { plugins: { p: plugin } } });
        return { plugin, seen: [] };
    }

    it("replaces a property, records the calls and keeps `this`", () => {
        const { plugin } = stubPlugin();
        const source = "() => function (value) { return this === undefined ? 'no this' : 'fake:' + value; }";
        expect(installFake({ id: "f1", pluginId: "p", path: "transport", source })).toEqual({ ok: true });
        expect(plugin.transport("a")).toBe("fake:a");
        expect(plugin.transport("b")).toBe("fake:b");
        expect(readFakeCalls("f1")).toEqual([["a"], ["b"]]);
    });

    it("replaces a nested property", () => {
        const { plugin } = stubPlugin();
        installFake({ id: "f2", pluginId: "p", path: "nested.call", source: "() => () => 'fake'" });
        expect(plugin.nested.call()).toBe("fake");
    });

    it("puts the original back and forgets the record", () => {
        const { plugin } = stubPlugin();
        const original = plugin.transport;
        installFake({ id: "f3", pluginId: "p", path: "transport", source: "() => () => 'fake'" });
        expect(removeFake("f3")).toBe(true);
        expect(plugin.transport).toBe(original);
        expect(readFakeCalls("f3")).toBeNull();
        expect(removeFake("f3")).toBe(false);
    });

    it("deletes a property that was inherited instead of leaving an own copy", () => {
        class Base {
            greet(): string {
                return "base";
            }
        }
        const plugin = new Base();
        vi.stubGlobal("app", { plugins: { plugins: { p: plugin } } });
        installFake({ id: "f4", pluginId: "p", path: "greet", source: "() => () => 'fake'" });
        expect(Object.hasOwn(plugin, "greet")).toBe(true);
        removeFake("f4");
        expect(Object.hasOwn(plugin, "greet")).toBe(false);
        expect(plugin.greet()).toBe("base");
    });

    it("works with an async function and returns its promise", async () => {
        const { plugin } = stubPlugin();
        installFake({ id: "f5", pluginId: "p", path: "transport", source: "() => async (v) => 'async:' + v" });
        expect(await (plugin.transport("x") as unknown as Promise<string>)).toBe("async:x");
    });

    it("refuses a plugin that is not loaded, listing the loaded ones", () => {
        stubPlugin();
        const result = installFake({ id: "f6", pluginId: "q", path: "transport", source: "() => () => 1" });
        expect(result).toEqual({ ok: false, reason: 'plugin "q" is not loaded (loaded: p)' });
        vi.stubGlobal("app", {});
        expect(installFake({ id: "f6", pluginId: "q", path: "t", source: "() => () => 1" })).toEqual({ ok: false, reason: 'plugin "q" is not loaded (loaded: none)' });
    });

    it("refuses a missing property and an intermediate that is not an object, changing nothing", () => {
        const { plugin } = stubPlugin();
        const missing = installFake({ id: "f7", pluginId: "p", path: "transprot", source: "() => () => 1" });
        expect(missing).toMatchObject({ ok: false, reason: expect.stringContaining('has no property "transprot"') as string });
        const notObject = installFake({ id: "f8", pluginId: "p", path: "transport.deep", source: "() => () => 1" });
        expect(notObject).toMatchObject({ ok: false, reason: expect.stringContaining('"transport" in "transport.deep" is not an object') as string });
        const nullStep = installFake({ id: "f9", pluginId: "p", path: "gone.x", source: "() => () => 1" });
        expect(nullStep.ok).toBe(false);
        expect(plugin.transport("a")).toBe("real:a");
        expect(readFakeCalls("f7")).toBeNull();
    });

    it("refuses an empty path segment", () => {
        stubPlugin();
        expect(installFake({ id: "fa", pluginId: "p", path: "nested.", source: "() => () => 1" }).ok).toBe(false);
    });

    it("refuses a factory that is not a function, changing nothing", () => {
        const { plugin } = stubPlugin();
        const result = installFake({ id: "fb", pluginId: "p", path: "transport", source: "42" });
        expect(result).toEqual({
            ok: false,
            reason: "the replacement factory is not a function; pass an arrow function or a function expression that returns the replacement",
        });
        expect(plugin.transport("a")).toBe("real:a");
    });

    it("refuses a factory that returns something other than a function, changing nothing", () => {
        const { plugin } = stubPlugin();
        // The old direct form: the function itself was the replacement. Now it would be called as the factory.
        const result = installFake({ id: "fc", pluginId: "p", path: "transport", source: "(request) => `fake:${request}`", arg: "x" });
        expect(result).toEqual({ ok: false, reason: "the replacement factory did not return a function; return the function that replaces the property" });
        expect(plugin.transport("a")).toBe("real:a");
        expect(readFakeCalls("fc")).toBeNull();
    });

    it("refuses a factory that throws, with its message, changing nothing", () => {
        const { plugin } = stubPlugin();
        // What a factory that closed over a variable of the test looks like once it runs in the page.
        const result = installFake({ id: "fd", pluginId: "p", path: "transport", source: "() => { return testVariable; }" });
        expect(result).toEqual({ ok: false, reason: "the replacement factory threw: testVariable is not defined" });
        expect(plugin.transport("a")).toBe("real:a");
    });

    it("calls the factory once with the argument, and keeps its state between calls of the replacement", () => {
        const { plugin } = stubPlugin();
        const source = "(config) => { let n = 0; return (request) => config.prefix + request + (n += 1); }";
        expect(installFake({ id: "fe", pluginId: "p", path: "transport", source, arg: { prefix: "fake:" } })).toEqual({ ok: true });
        expect(plugin.transport("a")).toBe("fake:a1");
        expect(plugin.transport("b")).toBe("fake:b2");
        expect(readFakeCalls("fe")).toEqual([["a"], ["b"]]);
    });

    it("passes undefined to a factory that is given no argument", () => {
        const { plugin } = stubPlugin();
        installFake({ id: "ff", pluginId: "p", path: "transport", source: "(arg) => () => typeof arg" });
        expect(plugin.transport("a")).toBe("undefined");
    });

    it("knows no calls for an id it never saw", () => {
        vi.stubGlobal("app", {});
        expect(readFakeCalls("zzz")).toBeNull();
        expect(removeFake("zzz")).toBe(false);
    });
});

describe("mobile scripts", () => {
    it("compares the window width", () => {
        vi.stubGlobal("innerWidth", 390);
        expect(hasInnerWidth(390)).toBe(true);
        expect(hasInnerWidth(400)).toBe(false);
    });

    it("lists the enabled plugins", () => {
        vi.stubGlobal("app", { plugins: { enabledPlugins: new Set(["a", "b"]) } });
        expect(enabledPluginIds()).toEqual(["a", "b"]);
        vi.stubGlobal("app", {});
        expect(enabledPluginIds()).toEqual([]);
    });

    it("tells the old page from the reloaded one by the flag", () => {
        vi.stubGlobal("app", { workspace: { layoutReady: true } });
        expect(isReloaded()).toBe(true);
        markBeforeReload();
        expect(isReloaded()).toBe(false);
        vi.stubGlobal("__opdkBeforeReload", undefined);
        vi.stubGlobal("app", { workspace: { layoutReady: false } });
        expect(isReloaded()).toBe(false);
    });

    it("starts Obsidian's reload through the app:reload command", () => {
        const executeCommandById = vi.fn(() => true);
        vi.stubGlobal("app", { commands: { commands: { "app:reload": {} }, executeCommandById } });
        expect(reloadApp()).toBe("started");
        expect(executeCommandById).toHaveBeenCalledWith("app:reload");
    });

    it("says missing, without running anything, when there is no app:reload command, no registry or no executeCommandById", () => {
        const executeCommandById = vi.fn(() => true);
        vi.stubGlobal("app", { commands: { commands: { "editor:save": {} }, executeCommandById } });
        expect(reloadApp()).toBe("missing");
        expect(executeCommandById).not.toHaveBeenCalled();
        vi.stubGlobal("app", { commands: { commands: { "app:reload": {} } } });
        expect(reloadApp()).toBe("missing");
        vi.stubGlobal("app", {});
        expect(reloadApp()).toBe("missing");
    });

    it("says refused when the command exists and Obsidian declines to run it", () => {
        const executeCommandById = vi.fn(() => false);
        vi.stubGlobal("app", { commands: { commands: { "app:reload": {} }, executeCommandById } });
        expect(reloadApp()).toBe("refused");
        expect(executeCommandById).toHaveBeenCalledWith("app:reload");
    });

    it("starts the emulation and reads the body class", () => {
        const emulateMobile = vi.fn();
        vi.stubGlobal("app", { emulateMobile });
        switchMobileEmulation(true);
        expect(emulateMobile).toHaveBeenCalledWith(true);
        vi.stubGlobal("document", { body: { classList: { contains: (name: string) => name === "is-mobile" } } });
        expect(isMobileApplied(true)).toBe(true);
        expect(isMobileApplied(false)).toBe(false);
    });
});

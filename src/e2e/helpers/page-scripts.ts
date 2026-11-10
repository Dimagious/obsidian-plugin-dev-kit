/**
 * Functions Playwright serializes and runs inside Obsidian, for the `obsidian` helpers. Like `../page-scripts.ts`,
 * each one must be self-contained: only its source text crosses into the page, so it cannot call another function
 * of this file or use an import. They are exported so tests can run them against a fake `globalThis`. The page's
 * own DOM and Obsidian types are not available to the kit (`lib` has no DOM), hence the small interfaces below.
 */

interface PagePosition {
    line: number;
    ch: number;
}

interface PageEditor {
    getValue(): string;
    getSelection(): string;
    listSelections(): { anchor: PagePosition; head: PagePosition }[];
    setCursor(position: PagePosition): void;
    focus(): void;
    /** The CodeMirror 6 view behind the editor. */
    cm?: { composing?: boolean };
}

interface PageView {
    getState?(): Record<string, unknown>;
    setState?(state: Record<string, unknown>, result: { history: boolean }): Promise<void>;
}

interface PageLeaf {
    view: PageView;
    openFile(file: unknown, state: Record<string, unknown>): Promise<void>;
}

/** One of the two side panels of the workspace (`app.workspace.leftSplit` and `rightSplit`). */
interface PageSidebar {
    collapsed?: boolean;
    collapse?(): void;
    expand?(): void;
}

interface PageElement {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    classList: { contains(name: string): boolean };
    remove(): void;
    contains(other: unknown): boolean;
}

/**
 * The slice of Obsidian's `app` the helpers touch. Most of it is internal API (`app.setting`, `app.commands`,
 * `app.emulateMobile`, `app.changeTheme`, `vault.getConfig`, `customCss`) that is not in the public typings.
 * Verified on Obsidian 1.14.5; a newer Obsidian may rename it, and the helper then fails with the message of the step
 * that broke.
 */
interface PageApp {
    commands?: {
        commands?: Record<string, { checkCallback?: (checking: boolean) => unknown } | undefined>;
        executeCommandById?(id: string): boolean;
    };
    setting?: {
        open?(): void;
        close?(): void;
        openTabById?(id: string): void;
        pluginTabs?: { id: string }[];
        settingTabs?: { id: string }[];
    };
    vault?: {
        getAbstractFileByPath?(path: string): { extension?: unknown } | null;
        getMarkdownFiles?(): unknown[];
        getConfig?(key: string): unknown;
        setConfig?(key: string, value: unknown): void;
    };
    workspace?: {
        getLeaf?(newLeaf: boolean): PageLeaf;
        setActiveLeaf?(leaf: PageLeaf, options: { focus: boolean }): void;
        getActiveFile?(): { path: string } | null;
        activeEditor?: { editor?: PageEditor } | null;
        trigger?(name: string): void;
        layoutReady?: boolean;
        leftSplit?: PageSidebar;
        rightSplit?: PageSidebar;
    };
    metadataCache?: { getFileCache?(file: unknown): unknown };
    plugins?: { plugins?: Record<string, Record<string, unknown> | undefined>; enabledPlugins?: Set<string> };
    customCss?: { themes?: Record<string, unknown>; setTheme?(name: string): void };
    changeTheme?(name: string): void;
    emulateMobile?(on: boolean): void;
}

interface FakeRecord {
    calls: unknown[][];
    owner: Record<string, unknown>;
    key: string;
    hadOwn: boolean;
    original: unknown;
}

interface PageGlobals {
    app?: PageApp;
    document?: {
        body: PageElement;
        activeElement: unknown;
        querySelector(selector: string): PageElement | null;
        querySelectorAll(selector: string): ArrayLike<PageElement>;
    };
    innerWidth?: number;
    requestAnimationFrame?(callback: () => void): number;
    __opdkFakes?: Map<string, FakeRecord>;
    __opdkBeforeReload?: boolean;
}

// --- settings ---------------------------------------------------------------------------------------------

/** Whether a settings tab with this id is registered (a community plugin's or a core one). */
export function hasSettingTab(id: string): boolean {
    const setting = (globalThis as unknown as PageGlobals).app?.setting;
    return [...(setting?.pluginTabs ?? []), ...(setting?.settingTabs ?? [])].some((tab) => tab.id === id);
}

/** The ids of every registered settings tab, for the error of a tab that does not exist. */
export function listSettingTabIds(): string[] {
    const setting = (globalThis as unknown as PageGlobals).app?.setting;
    return [...(setting?.settingTabs ?? []), ...(setting?.pluginTabs ?? [])].map((tab) => tab.id);
}

/** Opens the settings modal (unless it is open already, which would stack a second one), on the tab `id` when given. */
export function openSettingsModal(id: string | null): void {
    const globals = globalThis as unknown as PageGlobals;
    const setting = globals.app?.setting;
    if (globals.document?.querySelector(".modal.mod-settings") === null || globals.document === undefined) {
        setting?.open?.();
    }
    if (id !== null) {
        setting?.openTabById?.(id);
    }
}

export function closeSettingsModal(): void {
    (globalThis as unknown as PageGlobals).app?.setting?.close?.();
}

// --- commands ---------------------------------------------------------------------------------------------

export type RunCommandResult = { state: "ran" } | { state: "declined" } | { state: "missing"; ids: string[] };

/** Runs a command through Obsidian's own executor, the one the palette and hotkeys use. */
export function runCommandById(id: string): RunCommandResult {
    const commands = (globalThis as unknown as PageGlobals).app?.commands;
    const registered = commands?.commands ?? {};
    if (!(id in registered)) {
        return { state: "missing", ids: Object.keys(registered) };
    }
    // executeCommandById gives no signal for a declined command: Obsidian 1.14.5 returns true for a command whose
    // checkCallback returned false (and false only for an unknown id). So the check runs first, in its check-only form.
    const command = registered[id];
    if (typeof command?.checkCallback === "function" && command.checkCallback(true) === false) {
        return { state: "declined" };
    }
    return commands?.executeCommandById?.(id) === false ? { state: "declined" } : { state: "ran" };
}

// --- files and editor ---------------------------------------------------------------------------------------

export interface PageViewState {
    mode?: string;
    source?: boolean;
}

export type OpenFileResult = { found: false } | { found: true; view: PageViewState | null };

/**
 * Opens a note in the active tab and, when a mode is wanted, forces it. `openFile` takes the requested state only
 * when it opens the note; for a note already open in this tab it keeps the mode it has, so the view's state is set
 * directly afterwards. Returns the mode the view ended up in so the caller can verify it.
 */
export async function openFileInMode(args: { path: string; wanted: { mode: string; source: boolean } | null }): Promise<OpenFileResult> {
    const { app } = globalThis as unknown as PageGlobals;
    const file = app?.vault?.getAbstractFileByPath?.(args.path);
    const leaf = app?.workspace?.getLeaf?.(false);
    if (file === null || file === undefined || typeof file.extension !== "string" || leaf === undefined) {
        return { found: false };
    }
    const { wanted } = args;
    await leaf.openFile(file, wanted === null ? { active: true } : { active: true, state: wanted });
    app?.workspace?.setActiveLeaf?.(leaf, { focus: true });
    const state = leaf.view.getState?.();
    if (wanted !== null && state !== undefined) {
        const mismatch = state.mode !== wanted.mode || (wanted.mode === "source" && state.source !== wanted.source);
        if (mismatch) {
            await leaf.view.setState?.({ ...state, mode: wanted.mode, source: wanted.source }, { history: false });
        }
    }
    const final = leaf.view.getState?.();
    if (final === undefined) {
        return { found: true, view: null };
    }
    return { found: true, view: { mode: String(final.mode), source: final.source === true } };
}

export function readActiveFilePath(): string | null {
    return (globalThis as unknown as PageGlobals).app?.workspace?.getActiveFile?.()?.path ?? null;
}

/** The whole document of the active editor. `getValue()`, not the DOM: CodeMirror only renders the visible lines. */
export function readEditorText(): string | null {
    return (globalThis as unknown as PageGlobals).app?.workspace?.activeEditor?.editor?.getValue() ?? null;
}

export interface PageSelection {
    text: string;
    anchor: PagePosition;
    head: PagePosition;
}

export function readEditorSelection(): PageSelection | null {
    const editor = (globalThis as unknown as PageGlobals).app?.workspace?.activeEditor?.editor;
    const first = editor?.listSelections()[0];
    if (editor === undefined || first === undefined) {
        return null;
    }
    return { text: editor.getSelection(), anchor: first.anchor, head: first.head };
}

/** Focuses the active editor and puts the cursor at `position` (CodeMirror clamps a position past the end). */
export function placeEditorCursor(position: PagePosition): boolean {
    const editor = (globalThis as unknown as PageGlobals).app?.workspace?.activeEditor?.editor;
    if (editor === undefined) {
        return false;
    }
    editor.focus();
    editor.setCursor(position);
    return true;
}

/** True when the keyboard focus is inside the first element that matches `selector`. */
export function isFocusInside(selector: string): boolean {
    const document = (globalThis as unknown as PageGlobals).document;
    return document?.querySelector(selector)?.contains(document.activeElement) === true;
}

export function isEditorEmpty(): boolean {
    return (globalThis as unknown as PageGlobals).app?.workspace?.activeEditor?.editor?.getValue() === "";
}

/** True once the document is not `before` any more. */
export function editorTextChanged(before: string): boolean {
    const text = (globalThis as unknown as PageGlobals).app?.workspace?.activeEditor?.editor?.getValue();
    return text !== undefined && text !== before;
}

/**
 * True when CodeMirror is not inside a composition. It keeps the flag set for a moment after the commit, and a next
 * composition started inside that window would be read as the same one.
 */
export function isEditorSettled(): boolean {
    return (globalThis as unknown as PageGlobals).app?.workspace?.activeEditor?.editor?.cm?.composing !== true;
}

// --- appearance and state -----------------------------------------------------------------------------------

export type ApplyThemeResult = { ok: true } | { ok: false; themes: string[] };

/**
 * Sets the colour scheme (`obsidian` is dark, `moonstone` is light) the way Obsidian's appearance settings do, then
 * the community theme when one is named (an empty string is the default theme). Reports the installed themes when
 * the named one is not among them.
 */
export function applyTheme(args: { scheme: string; theme: string | null }): ApplyThemeResult {
    const { app } = globalThis as unknown as PageGlobals;
    if (args.theme !== null && args.theme !== "") {
        const themes = Object.keys(app?.customCss?.themes ?? {});
        if (!themes.includes(args.theme)) {
            return { ok: false, themes };
        }
    }
    app?.changeTheme?.(args.scheme);
    app?.vault?.setConfig?.("theme", args.scheme);
    if (args.theme !== null) {
        app?.customCss?.setTheme?.(args.theme);
    }
    app?.workspace?.trigger?.("css-change");
    return { ok: true };
}

/** True once the body carries the class of the wanted scheme (`theme-dark` or `theme-light`). */
export function isSchemeApplied(scheme: string): boolean {
    const cls = scheme === "obsidian" ? "theme-dark" : "theme-light";
    return (globalThis as unknown as PageGlobals).document?.body.classList.contains(cls) === true;
}

export interface MetadataCacheState {
    total: number;
    cached: number;
}

export function metadataCacheState(): MetadataCacheState {
    const app = (globalThis as unknown as PageGlobals).app;
    const files = app?.vault?.getMarkdownFiles?.() ?? [];
    const cached = files.filter((file) => Boolean(app?.metadataCache?.getFileCache?.(file))).length;
    return { total: files.length, cached };
}

/** True when every markdown file of the vault has its metadata cached; a vault with none is complete at once. */
export function isMetadataCacheComplete(): boolean {
    const app = (globalThis as unknown as PageGlobals).app;
    const files = app?.vault?.getMarkdownFiles?.() ?? [];
    return files.every((file) => Boolean(app?.metadataCache?.getFileCache?.(file)));
}

/** Removes every notice from the DOM and returns how many there were. */
export function removeNotices(): number {
    const notices = Array.from((globalThis as unknown as PageGlobals).document?.querySelectorAll(".notice") ?? []);
    for (const notice of notices) {
        notice.remove();
    }
    return notices.length;
}

export function hideNoteProperties(): void {
    (globalThis as unknown as PageGlobals).app?.vault?.setConfig?.("propertiesInDocument", "hidden");
}

/**
 * Collapses (`true`) or expands (`false`) the left and right side panels. Returns false when this Obsidian has no such
 * split object, so the helper can fail with a message instead of waiting for a state that cannot come.
 */
export function setSidebarsCollapsed(collapsed: boolean): boolean {
    const workspace = (globalThis as unknown as PageGlobals).app?.workspace;
    const splits = [workspace?.leftSplit, workspace?.rightSplit];
    for (const split of splits) {
        if (typeof split?.collapse !== "function" || typeof split.expand !== "function") {
            return false;
        }
    }
    for (const split of splits) {
        if (collapsed) {
            split?.collapse?.();
        } else {
            split?.expand?.();
        }
    }
    return true;
}

/** True when both side panels are in the wanted state; the panels animate, so `collapse()` returns before it holds. */
export function areSidebarsCollapsed(collapsed: boolean): boolean {
    const workspace = (globalThis as unknown as PageGlobals).app?.workspace;
    return [workspace?.leftSplit, workspace?.rightSplit].every((split) => split?.collapsed === collapsed);
}

export function readConfig(key: string): unknown {
    return (globalThis as unknown as PageGlobals).app?.vault?.getConfig?.(key);
}

/**
 * Scrolls the first element matching `selector` from top to bottom in steps a little shorter than its height, so
 * blocks that render when they come into view are drawn. Returns false when nothing matches. It stays at the bottom:
 * the reading view drops the sections that leave the viewport, so scrolling back to the top removed the block the
 * scroll had just drawn (found live in Obsidian 1.14.5).
 * Between steps it waits two animation frames (an IntersectionObserver reports on the next frame), with a 100 ms
 * fallback timer because a window that is not visible does not run frames. The height is read again every step,
 * since drawing a block can make the note longer.
 */
export async function scrollThroughElement(selector: string): Promise<boolean> {
    const globals = globalThis as unknown as PageGlobals;
    const root = globals.document?.querySelector(selector) ?? null;
    if (root === null) {
        return false;
    }
    const frame = (): Promise<void> =>
        new Promise((resolve) => {
            const timer = setTimeout(resolve, 100);
            globals.requestAnimationFrame?.(() => {
                globals.requestAnimationFrame?.(() => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        });
    const maxSteps = 500;
    let top = 0;
    for (let step = 0; step < maxSteps; step++) {
        root.scrollTop = top;
        await frame();
        if (top >= root.scrollHeight - root.clientHeight) {
            break;
        }
        top += Math.max(200, root.clientHeight - 100);
    }
    return true;
}

// --- evaluate ----------------------------------------------------------------------------------------------

export type RunWithAppResult = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Rebuilds `source` (the text of a function) and calls it with `window.app` and `arg`; the result is awaited. The
 * function crossed the process boundary as source text, so it is rebuilt with an indirect eval. A refusal comes back
 * as a reason; an exception thrown by the function itself is not caught here and reaches the test as it is.
 */
export async function runWithApp(args: { source: string; arg?: unknown }): Promise<RunWithAppResult> {
    const { app } = globalThis as unknown as PageGlobals;
    if (app === undefined) {
        return { ok: false, reason: "window.app is not defined yet" };
    }
    let fn: unknown;
    try {
        fn = (0, eval)(`(${args.source})`);
    } catch (error) {
        return { ok: false, reason: `the function could not be rebuilt in the page: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (typeof fn !== "function") {
        return { ok: false, reason: "the argument is not a function; pass an arrow function or a function expression" };
    }
    return { ok: true, value: await (fn as (app: unknown, arg: unknown) => unknown)(app, args.arg) };
}

// --- fakes -------------------------------------------------------------------------------------------------

export type InstallFakeResult = { ok: true } | { ok: false; reason: string };

/**
 * Replaces `plugin[path]` (a dotted path) on the live plugin instance. `source` is the text of a factory: it is
 * rebuilt here, called once with `arg`, and the function it returns becomes the replacement, wrapped so that every
 * call's arguments are recorded under `id`. The factory runs once, so what it declares stays alive between calls.
 * The previous value is kept for `removeFake`. Refuses a plugin that is not loaded, a path that does not exist and a
 * factory that fails or does not return a function, so a typo cannot pass silently. Nothing is changed on a refusal.
 */
export function installFake(args: { id: string; pluginId: string; path: string; source: string; arg?: unknown }): InstallFakeResult {
    const globals = globalThis as unknown as PageGlobals;
    const plugins = globals.app?.plugins?.plugins ?? {};
    const plugin = plugins[args.pluginId];
    if (plugin === undefined) {
        return { ok: false, reason: `plugin "${args.pluginId}" is not loaded (loaded: ${Object.keys(plugins).join(", ") || "none"})` };
    }
    const keys = args.path.split(".");
    const key = keys.pop() ?? "";
    let owner: Record<string, unknown> = plugin;
    for (const step of keys) {
        const next = owner[step];
        if (typeof next !== "object" || next === null) {
            return { ok: false, reason: `"${step}" in "${args.path}" is not an object on plugin "${args.pluginId}"` };
        }
        owner = next as Record<string, unknown>;
    }
    if (key === "" || !(key in owner)) {
        return { ok: false, reason: `plugin "${args.pluginId}" has no property "${args.path}" (properties: ${Object.keys(owner).join(", ")})` };
    }
    let impl: unknown;
    try {
        // Indirect eval: the factory crosses the process boundary as source text, and has to be rebuilt in the page.
        const factory: unknown = (0, eval)(`(${args.source})`);
        if (typeof factory !== "function") {
            return { ok: false, reason: "the replacement factory is not a function; pass an arrow function or a function expression that returns the replacement" };
        }
        impl = (factory as (arg: unknown) => unknown)(args.arg);
    } catch (error) {
        return { ok: false, reason: `the replacement factory threw: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (typeof impl !== "function") {
        return { ok: false, reason: "the replacement factory did not return a function; return the function that replaces the property" };
    }
    const record: FakeRecord = {
        calls: [],
        owner,
        key,
        hadOwn: Object.hasOwn(owner, key),
        original: owner[key],
    };
    globals.__opdkFakes ??= new Map();
    globals.__opdkFakes.set(args.id, record);
    owner[key] = function (this: unknown, ...callArgs: unknown[]): unknown {
        record.calls.push(callArgs);
        return (impl as (...values: unknown[]) => unknown).apply(this, callArgs);
    };
    return { ok: true };
}

export function readFakeCalls(id: string): unknown[][] | null {
    return (globalThis as unknown as PageGlobals).__opdkFakes?.get(id)?.calls ?? null;
}

/** Puts the original value back (deleting the property if it was inherited) and forgets the record. */
export function removeFake(id: string): boolean {
    const fakes = (globalThis as unknown as PageGlobals).__opdkFakes;
    const record = fakes?.get(id);
    if (record === undefined) {
        return false;
    }
    if (record.hadOwn) {
        record.owner[record.key] = record.original;
    } else {
        // Reflect.deleteProperty, not `delete`: the key is dynamic.
        Reflect.deleteProperty(record.owner, record.key);
    }
    fakes?.delete(id);
    return true;
}

// --- mobile ------------------------------------------------------------------------------------------------

export function hasInnerWidth(width: number): boolean {
    return (globalThis as unknown as PageGlobals).innerWidth === width;
}

/** The ids of the plugins Obsidian has enabled, which the page loads again after a reload. */
export function enabledPluginIds(): string[] {
    return Array.from((globalThis as unknown as PageGlobals).app?.plugins?.enabledPlugins ?? []);
}

/** Sets a flag that a reload wipes, so the wait can tell the old page from the new one. */
export function markBeforeReload(): void {
    (globalThis as unknown as PageGlobals).__opdkBeforeReload = true;
}

export function isReloaded(): boolean {
    const globals = globalThis as unknown as PageGlobals;
    return globals.__opdkBeforeReload !== true && globals.app?.workspace?.layoutReady === true;
}

/** Starts Obsidian's mobile emulation. The window reloads, so a call that works never returns. */
export function switchMobileEmulation(on: boolean): void {
    (globalThis as unknown as PageGlobals).app?.emulateMobile?.(on);
}

/** True once the body class says whether Obsidian runs as mobile. */
export function isMobileApplied(on: boolean): boolean {
    return (globalThis as unknown as PageGlobals).document?.body.classList.contains("is-mobile") === on;
}

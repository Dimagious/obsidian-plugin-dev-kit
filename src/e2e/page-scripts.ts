/**
 * Functions Playwright serializes and runs inside Obsidian. Each one must be self-contained: it cannot use
 * imports or other functions of this file, because only its source text crosses into the page. They are exported
 * so tests can run them against a fake `globalThis`.
 */

/** The slice of Obsidian's window globals these scripts read. */
interface ObsidianGlobals {
    app?: {
        workspace?: { layoutReady?: boolean };
        plugins?: { plugins?: Record<string, unknown>; loadingPluginId?: string | null };
    };
    require?: (id: string) => unknown;
    localStorage?: { setItem(key: string, value: string): void };
}

/** Init script: marks community plugins as trusted for the vault, so Obsidian never shows the "Do you trust the author" dialog. */
export function applyTrust(key: string): void {
    (globalThis as unknown as ObsidianGlobals).localStorage?.setItem(key, "true");
}

/** What `isReady` is still waiting for. A plugin id is in at most one of `missing` and `loading`. */
export interface ReadinessState {
    hasApp: boolean;
    layoutReady: boolean;
    /** Not in `app.plugins.plugins` yet: Obsidian has not started loading it. */
    missing: string[];
    /** `app.plugins.loadingPluginId` is this id: Obsidian is inside its `onload()`. */
    loading: string[];
}

/**
 * Reads the readiness state of the window. Obsidian registers `plugins[id]` before it awaits the plugin's `onload()`
 * and sets `app.plugins.loadingPluginId` to the id while that runs (cleared to null once `loadPlugin` resolves), so
 * "present in `plugins`" alone is not "loaded": commands and settings tabs that `onload()` adds after an `await`
 * would not exist yet.
 */
export function readinessState(ids: readonly string[]): ReadinessState {
    const app = (globalThis as unknown as ObsidianGlobals).app;
    const loaded = app?.plugins?.plugins;
    const loadingId = app?.plugins?.loadingPluginId;
    const loading = ids.filter((id) => loadingId === id);
    return {
        hasApp: app !== undefined,
        layoutReady: app?.workspace?.layoutReady === true,
        missing: ids.filter((id) => loadingId !== id && loaded?.[id] === undefined),
        loading,
    };
}

/**
 * True once the workspace layout is ready and, for every plugin in `ids`, `plugins[id]` exists and Obsidian is no
 * longer inside that plugin's `onload()`. Written out in full (not as a call to `readinessState`) because only this
 * function's own source text crosses into the page.
 */
export function isReady(ids: readonly string[]): boolean {
    const app = (globalThis as unknown as ObsidianGlobals).app;
    const loaded = app?.plugins?.plugins;
    const loadingId = app?.plugins?.loadingPluginId;
    return (
        app?.workspace?.layoutReady === true &&
        loaded !== undefined &&
        ids.every((id) => loaded[id] !== undefined && loadingId !== id)
    );
}

/** The Obsidian version, asked the same way Obsidian's own shell asks. `null` when the renderer cannot answer. */
export function readRunningVersion(): string | null {
    const globals = globalThis as unknown as ObsidianGlobals;
    const electron = globals.require?.("electron") as
        | { ipcRenderer?: { sendSync?: (channel: string) => unknown } }
        | undefined;
    const version = electron?.ipcRenderer?.sendSync?.("version");
    return typeof version === "string" ? version : null;
}

/** The slice of Electron's main-process module `resizeMainWindow` uses. */
export interface ElectronMain {
    BrowserWindow: { getAllWindows(): { setSize(width: number, height: number): void; center(): void }[] };
}

/** Runs in the main process (`app.evaluate`): sizes and centres the first window. */
export function resizeMainWindow({ BrowserWindow }: ElectronMain, size: { width: number; height: number }): void {
    const window = BrowserWindow.getAllWindows()[0];
    window?.setSize(size.width, size.height);
    window?.center();
}

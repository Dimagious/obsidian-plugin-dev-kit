/**
 * Obsidian's `app` as the specs and the kit's page scripts reach it: the internal API that is not in the `obsidian`
 * typings (`app.plugins.enablePlugin`, `app.setting`, `app.commands`, `vault.getConfig`, ...). The kit's TypeScript has
 * no DOM and no `obsidian` types, so these are narrow structural types of what is used, not a copy of Obsidian's.
 * Verified on Obsidian 1.14.5; a newer Obsidian may rename a member, and the code that reads it then fails with its
 * own message. A member that only some versions have is optional here.
 */

/** A position in a note; both numbers start at 0. */
export interface PagePosition {
    line: number;
    ch: number;
}

/** The editor of a note (`app.workspace.activeEditor.editor`). */
export interface PageEditor {
    getValue(): string;
    getSelection(): string;
    listSelections(): { anchor: PagePosition; head: PagePosition }[];
    setCursor(position: PagePosition): void;
    focus(): void;
    /** The CodeMirror 6 view behind the editor. */
    cm?: { composing?: boolean };
}

export interface PageView {
    getState?(): Record<string, unknown>;
    setState?(state: Record<string, unknown>, result: { history: boolean }): Promise<void>;
}

export interface PageLeaf {
    view: PageView;
    openFile(file: unknown, state: Record<string, unknown>): Promise<void>;
}

/** One of the two side panels of the workspace (`app.workspace.leftSplit` and `rightSplit`). */
export interface PageSidebar {
    collapsed?: boolean;
    collapse?(): void;
    expand?(): void;
}

/** A plugin instance from `app.plugins.plugins`. What a plugin adds to itself is `unknown` until the spec narrows it. */
export interface PluginInstance {
    manifest: { id: string; name?: string; version?: string };
    [member: string]: unknown;
}

/** An entry of `app.commands.commands`. */
export interface CommandEntry {
    id: string;
    name?: string;
    checkCallback?: (checking: boolean) => unknown;
}

/** A settings tab registered with `app.setting`. */
export interface SettingTabEntry {
    id: string;
}

/** An entry of `app.internalPlugins.plugins`: a core plugin such as `daily-notes` or `templates`. */
export interface InternalPluginEntry {
    enabled: boolean;
    instance?: Record<string, unknown>;
}

/**
 * The `app` object of the Obsidian window (`globalThis.app`). Use it as the type of the first parameter of
 * `obsidian.evaluate((app: AppWithInternals) => ...)`, or in a `win.evaluate` that reads `globalThis`.
 * `P` is the type of a plugin instance: `AppWithInternals<PluginInstance & { settings: MySettings }>` types
 * `app.plugins.plugins[id].settings` without a cast.
 */
export interface AppWithInternals<P extends PluginInstance = PluginInstance> {
    plugins: {
        /** Loaded community plugins by id. A plugin appears here before its `onload()` has finished. */
        plugins: Record<string, P | undefined>;
        /** The ids of the plugins that are switched on in the vault. */
        enabledPlugins: Set<string>;
        /** The id of the plugin whose `onload()` is running now, or `null`. */
        loadingPluginId: string | null;
        enablePlugin(id: string): Promise<unknown>;
        disablePlugin(id: string): Promise<unknown>;
    };
    setting: {
        open(): void;
        close(): void;
        openTabById(id: string): void;
        /** The tab that is shown; absent while the modal is closed. */
        activeTab?: SettingTabEntry | null;
        pluginTabs: SettingTabEntry[];
        settingTabs: SettingTabEntry[];
    };
    commands: {
        commands: Record<string, CommandEntry | undefined>;
        /** False when no command has this id, or when its `checkCallback` is not satisfied. */
        executeCommandById(id: string): boolean;
    };
    internalPlugins: {
        plugins: Record<string, InternalPluginEntry | undefined>;
    };
    metadataCache: {
        getFileCache(file: unknown): unknown;
        /** How many files are still queued for indexing; 0 once the cache is complete. */
        inProgressTaskCount?: number;
    };
    vault: {
        /** The settings of `.obsidian/app.json`, by key. `undefined` for a key that was never set. */
        getConfig(key: string): unknown;
        /** Changes the setting in memory; `saveConfig()` writes it to disk. */
        setConfig(key: string, value: unknown): void;
        saveConfig(): Promise<void>;
        getMarkdownFiles(): { path: string }[];
        getAbstractFileByPath(path: string): { path: string; extension?: unknown } | null;
        /** The e2e runs on the desktop app, where `basePath` is the absolute path of the vault. */
        adapter: { basePath: string };
    };
    workspace: {
        layoutReady: boolean;
        getLeaf(newLeaf: boolean): PageLeaf;
        setActiveLeaf(leaf: PageLeaf, options: { focus: boolean }): void;
        getActiveFile(): { path: string } | null;
        activeEditor: { editor?: PageEditor } | null;
        trigger(name: string): void;
        saveLayout(): Promise<void>;
        leftSplit: PageSidebar;
        rightSplit: PageSidebar;
    };
    customCss: { themes: Record<string, unknown>; setTheme(name: string): void };
    changeTheme(name: string): void;
    emulateMobile(on: boolean): void;
}

/**
 * What a page script can count on: `window.app` may not exist yet, and any member may be missing in another Obsidian
 * version, so every level is optional. For the kit's own scripts; a spec uses `AppWithInternals`.
 */
export type PartialApp = {
    [Key in keyof AppWithInternals]?: AppWithInternals[Key] extends (...args: never[]) => unknown
        ? AppWithInternals[Key]
        : Partial<AppWithInternals[Key]>;
};

import path from "node:path";
import { isExplicitVersion, normalizeVersion } from "./version.js";

/** One plugin to install into the test vault. */
export interface PluginOption {
    /** Plugin folder holding the built `main.js` and `manifest.json` (and `styles.css` when the plugin has one). Relative to the directory `playwright test` runs in. */
    readonly dir: string;
}

/** Size of the Obsidian window, in points. */
export interface WindowOption {
    readonly width: number;
    readonly height: number;
}

/** Time budgets, in milliseconds. */
export interface TimeoutOptions {
    /** `_electron.launch`. Default 45000. */
    readonly launch?: number;
    /** From the window opening until the workspace and every plugin are loaded. Default 30000. */
    readonly ready?: number;
    /** How long `app.close()` may take before the process tree is killed. Default 5000. */
    readonly close?: number;
    /** How long each kind of wait inside the `obsidian` helpers may take. */
    readonly helpers?: HelperTimeouts;
}

/**
 * Time budgets of the waits inside the `obsidian` helpers, in milliseconds. Each wait that runs out fails with a
 * message that names the wait and this option. Keep them below the Playwright test timeout (60000 in the preset),
 * or the test is killed before the helper can explain what it waited for.
 */
export interface HelperTimeouts {
    /** A plugin's settings tab to register (`openSettings(tab)`). Default 15000: Garmy's cold start needed a few seconds. */
    readonly settings?: number;
    /** Every markdown file to have its metadata cached (`waitForMetadataCache()`). Default 45000: Dashy's big vault took up to a minute. */
    readonly metadataCache?: number;
    /** CodeMirror to leave a composition and to show the composed text (`editor().compose()`). Default 5000. */
    readonly compose?: number;
    /** The body to get the class of the theme (`setTheme()`). Default 5000. */
    readonly theme?: number;
    /** A dialog, the palette, the editor or a view to appear or go away (`openCommandPalette()`, `openFile()`, `editor().type()`, `closeSettings()` and others). Default 10000. */
    readonly ui?: number;
}

/** Options of `createObsidianTest`. */
export interface ObsidianTestOptions {
    /** Vault copied into a fresh temp folder for every test. Overridden by the env var `OPDK_E2E_VAULT`. Relative to the directory `playwright test` runs in. */
    readonly seedVault: string;
    /** Plugins to install. Default: the plugin in the current directory. */
    readonly plugins?: readonly PluginOption[];
    /** `data.json` content per plugin id, written before Obsidian starts. Replaces a `data.json` the seed vault has for that plugin. */
    readonly data?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    /** Obsidian window size. Default: whatever Obsidian opens with. */
    readonly window?: WindowOption;
    /** Obsidian's `app.asar`. Default: the macOS install. Overridden by the env var `OBSIDIAN_PATH`. */
    readonly obsidianPath?: string;
    /** Extra Electron command-line arguments, for example `--use-mock-keychain`. */
    readonly electronArgs?: readonly string[];
    /** Fail the test when the running Obsidian is not this `x.y.z`. Overridden by the env var `OBSIDIAN_VERSION`. */
    readonly version?: string;
    readonly timeouts?: TimeoutOptions;
    /** Refuse a plugin whose `main.js` is older than its newest source file. Default `true`. The env var `OPDK_E2E_ALLOW_STALE_BUILD=1` turns it off for one run. */
    readonly staleBuildCheck?: boolean;
    /** Remove `opdk-e2e-*` temp folders older than this many hours when a worker starts. `false` disables it. Default 2. */
    readonly sweepAfterHours?: number | false;
}

export const DEFAULT_TIMEOUTS = { launch: 45_000, ready: 30_000, close: 5_000 } as const;
export const DEFAULT_HELPER_TIMEOUTS = { settings: 15_000, metadataCache: 45_000, compose: 5_000, theme: 5_000, ui: 10_000 } as const;
export const DEFAULT_SWEEP_HOURS = 2;

/** `ObsidianTestOptions` with defaults applied, paths absolute and env overrides folded in. */
export interface ResolvedOptions {
    readonly cwd: string;
    readonly seedVault: string;
    /** Absolute plugin folders, in install order. */
    readonly pluginDirs: readonly string[];
    readonly data: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly window: WindowOption | undefined;
    /** As given in the option, not resolved: `findObsidianAsar` resolves it and `OBSIDIAN_PATH` wins over it. */
    readonly obsidianPath: string | undefined;
    readonly electronArgs: readonly string[];
    readonly expectedVersion: string | null;
    readonly timeouts: Required<Omit<TimeoutOptions, "helpers">>;
    readonly helperTimeouts: Required<HelperTimeouts>;
    readonly staleBuildCheck: boolean;
    readonly sweepAfterHours: number | false;
}

const OPTION_KEYS = [
    "seedVault",
    "plugins",
    "data",
    "window",
    "obsidianPath",
    "electronArgs",
    "version",
    "timeouts",
    "staleBuildCheck",
    "sweepAfterHours",
];
const TIMEOUT_KEYS = ["launch", "ready", "close", "helpers"];
const HELPER_TIMEOUT_KEYS = ["settings", "metadataCache", "compose", "theme", "ui"];
const SOURCE = "createObsidianTest";

export interface ResolveContext {
    /** Directory relative paths are resolved against; `process.cwd()` in the fixture. */
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
}

/** Checks the options and folds in the env overrides. Pure: no disk access, so a typo fails at import time of `fixtures.ts`. Every error names the offending key. */
export function resolveOptions(value: unknown, context: ResolveContext): ResolvedOptions {
    if (!isRecord(value)) {
        throw new Error(`${SOURCE}: options must be an object with at least { seedVault }.`);
    }
    for (const key of Object.keys(value)) {
        if (!OPTION_KEYS.includes(key)) {
            throw new Error(`${SOURCE}: unknown option "${key}". Known options: ${OPTION_KEYS.join(", ")}.`);
        }
    }
    const { cwd, env } = context;
    const seedFromOption = requireString(value, "seedVault");
    const envVault = env.OPDK_E2E_VAULT;
    const seedVault = path.resolve(cwd, envVault !== undefined && envVault !== "" ? envVault : seedFromOption);
    return {
        cwd,
        seedVault,
        pluginDirs: resolvePlugins(value, cwd),
        data: resolveData(value),
        window: resolveWindow(value),
        obsidianPath: optionalString(value, "obsidianPath"),
        electronArgs: resolveElectronArgs(value),
        expectedVersion: resolveVersion(value, env),
        timeouts: resolveTimeouts(value),
        helperTimeouts: resolveHelperTimeouts(value),
        staleBuildCheck: resolveStaleCheck(value, env),
        sweepAfterHours: resolveSweep(value),
    };
}

function resolvePlugins(options: Record<string, unknown>, cwd: string): string[] {
    const value = own(options, "plugins");
    if (value === undefined) {
        return [cwd];
    }
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`${SOURCE}: "plugins" must be a non-empty array of { dir }.`);
    }
    const dirs = value.map((item: unknown, index) => {
        if (!isRecord(item) || typeof item.dir !== "string" || item.dir === "") {
            throw new Error(`${SOURCE}: "plugins[${String(index)}]" must be an object { dir: "<plugin folder>" }.`);
        }
        return path.resolve(cwd, item.dir);
    });
    const duplicate = dirs.find((dir, index) => dirs.indexOf(dir) !== index);
    if (duplicate !== undefined) {
        throw new Error(`${SOURCE}: "plugins" lists ${duplicate} twice.`);
    }
    return dirs;
}

function resolveData(options: Record<string, unknown>): Record<string, Record<string, unknown>> {
    const value = own(options, "data");
    if (value === undefined) {
        return {};
    }
    if (!isRecord(value)) {
        throw new Error(`${SOURCE}: "data" must be an object keyed by plugin id, for example { "my-plugin": { ... } }.`);
    }
    const result: Record<string, Record<string, unknown>> = {};
    for (const [id, content] of Object.entries(value)) {
        if (!isRecord(content)) {
            throw new Error(`${SOURCE}: "data[${JSON.stringify(id)}]" must be an object (it becomes data.json).`);
        }
        result[id] = content;
    }
    return result;
}

function resolveWindow(options: Record<string, unknown>): WindowOption | undefined {
    const value = own(options, "window");
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        throw new Error(`${SOURCE}: "window" must be an object { width, height }.`);
    }
    for (const key of Object.keys(value)) {
        if (key !== "width" && key !== "height") {
            throw new Error(`${SOURCE}: unknown key "window.${key}". Known keys: width, height.`);
        }
    }
    return { width: positiveInteger(value, "width", "window.width"), height: positiveInteger(value, "height", "window.height") };
}

function resolveElectronArgs(options: Record<string, unknown>): string[] {
    const value = own(options, "electronArgs");
    if (value === undefined) {
        return [];
    }
    const args: string[] = [];
    if (!Array.isArray(value)) {
        throw new Error(`${SOURCE}: "electronArgs" must be an array of non-empty strings.`);
    }
    for (const item of value) {
        if (typeof item !== "string" || item === "") {
            throw new Error(`${SOURCE}: "electronArgs" must be an array of non-empty strings.`);
        }
        args.push(item);
    }
    const reserved = args.find((arg) => arg.startsWith("--user-data-dir"));
    if (reserved !== undefined) {
        throw new Error(
            `${SOURCE}: "electronArgs" must not contain ${reserved}. The kit gives every test its own user-data folder.`,
        );
    }
    return args;
}

function resolveVersion(options: Record<string, unknown>, env: ResolveContext["env"]): string | null {
    const fromEnv = normalizeVersion(env.OBSIDIAN_VERSION);
    const fromOption = optionalString(options, "version");
    const chosen = fromEnv ?? normalizeVersion(fromOption);
    if (chosen === null) {
        return null;
    }
    if (!isExplicitVersion(chosen)) {
        const source = fromEnv === null ? 'the "version" option' : "OBSIDIAN_VERSION";
        throw new Error(
            `${SOURCE}: ${source} is "${chosen}", which is not an explicit x.y.z version. ` +
                `The kit verifies the installed Obsidian; it does not download versions or resolve channels such as "latest".`,
        );
    }
    return chosen;
}

function resolveTimeouts(options: Record<string, unknown>): Required<Omit<TimeoutOptions, "helpers">> {
    const value = own(options, "timeouts");
    if (value === undefined) {
        return { ...DEFAULT_TIMEOUTS };
    }
    if (!isRecord(value)) {
        throw new Error(`${SOURCE}: "timeouts" must be an object { launch, ready, close, helpers }.`);
    }
    for (const key of Object.keys(value)) {
        if (!TIMEOUT_KEYS.includes(key)) {
            throw new Error(`${SOURCE}: unknown key "timeouts.${key}". Known keys: ${TIMEOUT_KEYS.join(", ")}.`);
        }
    }
    return {
        launch: own(value, "launch") === undefined ? DEFAULT_TIMEOUTS.launch : positiveInteger(value, "launch", "timeouts.launch"),
        ready: own(value, "ready") === undefined ? DEFAULT_TIMEOUTS.ready : positiveInteger(value, "ready", "timeouts.ready"),
        close: own(value, "close") === undefined ? DEFAULT_TIMEOUTS.close : positiveInteger(value, "close", "timeouts.close"),
    };
}

function resolveHelperTimeouts(options: Record<string, unknown>): Required<HelperTimeouts> {
    const timeouts = own(options, "timeouts");
    const value = isRecord(timeouts) ? own(timeouts, "helpers") : undefined;
    if (value === undefined) {
        return { ...DEFAULT_HELPER_TIMEOUTS };
    }
    if (!isRecord(value)) {
        throw new Error(`${SOURCE}: "timeouts.helpers" must be an object { ${HELPER_TIMEOUT_KEYS.join(", ")} }.`);
    }
    for (const key of Object.keys(value)) {
        if (!HELPER_TIMEOUT_KEYS.includes(key)) {
            throw new Error(`${SOURCE}: unknown key "timeouts.helpers.${key}". Known keys: ${HELPER_TIMEOUT_KEYS.join(", ")}.`);
        }
    }
    const pick = (key: keyof HelperTimeouts): number =>
        own(value, key) === undefined ? DEFAULT_HELPER_TIMEOUTS[key] : positiveInteger(value, key, `timeouts.helpers.${key}`);
    return { settings: pick("settings"), metadataCache: pick("metadataCache"), compose: pick("compose"), theme: pick("theme"), ui: pick("ui") };
}

function resolveStaleCheck(options: Record<string, unknown>, env: ResolveContext["env"]): boolean {
    const value = own(options, "staleBuildCheck");
    if (value !== undefined && typeof value !== "boolean") {
        throw new Error(`${SOURCE}: "staleBuildCheck" must be a boolean.`);
    }
    if (env.OPDK_E2E_ALLOW_STALE_BUILD === "1") {
        return false;
    }
    return value ?? true;
}

function resolveSweep(options: Record<string, unknown>): number | false {
    const value = own(options, "sweepAfterHours");
    if (value === undefined) {
        return DEFAULT_SWEEP_HOURS;
    }
    if (value === false) {
        return false;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${SOURCE}: "sweepAfterHours" must be a positive number of hours or false.`);
    }
    return value;
}

function positiveInteger(record: Record<string, unknown>, key: string, label: string): number {
    const value = own(record, key);
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new Error(`${SOURCE}: "${label}" is required and must be a positive integer.`);
    }
    return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
    const value = own(record, key);
    if (typeof value !== "string" || value === "") {
        throw new Error(`${SOURCE}: "${key}" is required and must be a non-empty string.`);
    }
    return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
    const value = own(record, key);
    if (value !== undefined && typeof value !== "string") {
        throw new Error(`${SOURCE}: "${key}" must be a string.`);
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): unknown {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}

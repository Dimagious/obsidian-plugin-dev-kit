import fs from "node:fs";
import path from "node:path";
import { readManifest } from "../config/manifest.js";
import { writeJson } from "./vault.js";

/** A built plugin ready to be copied into the test vault. */
export interface PluginSource {
    /** From the plugin's `manifest.json`. */
    readonly id: string;
    readonly dir: string;
    readonly mainJs: string;
    readonly manifestJson: string;
    /** `undefined` when the plugin has no `styles.css`. */
    readonly stylesCss: string | undefined;
}

/** Reads the id from `<dir>/manifest.json` and checks that the build output is there. */
export function readPluginSource(dir: string): PluginSource {
    const manifest = readManifest(dir);
    const mainJs = path.join(dir, "main.js");
    if (!fs.existsSync(mainJs)) {
        throw new Error(`Plugin "${manifest.id}" has no built main.js in ${dir}. Run \`opdk build\` there first.`);
    }
    const stylesCss = path.join(dir, "styles.css");
    return {
        id: manifest.id,
        dir,
        mainJs,
        manifestJson: path.join(dir, "manifest.json"),
        stylesCss: fs.existsSync(stylesCss) ? stylesCss : undefined,
    };
}

/** Rejects two plugins with the same id (the second would silently overwrite the first in the vault). */
export function assertUniqueIds(sources: readonly PluginSource[]): void {
    const seen = new Map<string, string>();
    for (const source of sources) {
        const earlier = seen.get(source.id);
        if (earlier !== undefined) {
            throw new Error(`Plugins ${earlier} and ${source.dir} both have the id "${source.id}". Each plugin id can be installed once.`);
        }
        seen.set(source.id, source.dir);
    }
}

/** Rejects `data` for a plugin that is not installed: the entry would be written for nobody, usually a typo in the id. */
export function assertDataIdsInstalled(data: Readonly<Record<string, unknown>>, sources: readonly PluginSource[]): void {
    const ids = sources.map((source) => source.id);
    for (const id of Object.keys(data)) {
        if (!ids.includes(id)) {
            throw new Error(`The data option has an entry for "${id}", but the installed plugins are: ${ids.join(", ")}.`);
        }
    }
}

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Newest modification time among the non-test files under `<dir>/src`, or `undefined` when there is no `src` folder. */
export function newestSourceFile(dir: string): { file: string; mtimeMs: number } | undefined {
    const srcDir = path.join(dir, "src");
    if (!fs.existsSync(srcDir)) {
        return undefined;
    }
    let newest: { file: string; mtimeMs: number } | undefined;
    const walk = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && !TEST_FILE.test(entry.name)) {
                const { mtimeMs } = fs.statSync(full);
                if (newest === undefined || mtimeMs > newest.mtimeMs) {
                    newest = { file: full, mtimeMs };
                }
            }
        }
    };
    walk(srcDir);
    return newest;
}

/**
 * Refuses a plugin whose `main.js` is older than its newest source file: the e2e would test code that no longer
 * exists. It compares modification times, not content. A plugin folder without `src/` (a prebuilt dist) is not checked.
 */
export function assertBuildFresh(source: PluginSource): void {
    const newest = newestSourceFile(source.dir);
    if (newest === undefined) {
        return;
    }
    const built = fs.statSync(source.mainJs).mtimeMs;
    if (built < newest.mtimeMs) {
        throw new Error(
            `Stale build: main.js of "${source.id}" (${new Date(built).toISOString()}) is older than ` +
                `${path.relative(source.dir, newest.file)} (${new Date(newest.mtimeMs).toISOString()}). ` +
                `Run \`opdk build\` in ${source.dir}, or set staleBuildCheck: false (OPDK_E2E_ALLOW_STALE_BUILD=1 for one run).`,
        );
    }
}

/** Copies the build output into `.obsidian/plugins/<id>/`. Other files already there (a seeded `data.json`) stay. */
export function installPlugin(vaultPath: string, source: PluginSource): void {
    const target = path.join(vaultPath, ".obsidian", "plugins", source.id);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(source.mainJs, path.join(target, "main.js"));
    fs.copyFileSync(source.manifestJson, path.join(target, "manifest.json"));
    if (source.stylesCss !== undefined) {
        fs.copyFileSync(source.stylesCss, path.join(target, "styles.css"));
    }
}

/** Lists the ids in `community-plugins.json`, keeping any the seed vault already enables. */
export function writeCommunityPlugins(vaultPath: string, ids: readonly string[]): string[] {
    const file = path.join(vaultPath, ".obsidian", "community-plugins.json");
    let existing: unknown;
    try {
        existing = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
    }
    const kept: string[] = [];
    if (existing !== undefined) {
        if (!Array.isArray(existing) || !existing.every((item) => typeof item === "string")) {
            throw new Error(`${file} must be a JSON array of plugin ids.`);
        }
        kept.push(...existing);
    }
    const all = [...new Set([...kept, ...ids])];
    writeJson(file, all);
    return all;
}

/** Writes `.obsidian/plugins/<id>/data.json`, replacing the seed's. */
export function writePluginData(vaultPath: string, id: string, data: Readonly<Record<string, unknown>>): void {
    writeJson(path.join(vaultPath, ".obsidian", "plugins", id, "data.json"), data);
}

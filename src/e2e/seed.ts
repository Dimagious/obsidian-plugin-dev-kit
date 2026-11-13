import path from "node:path";
import { createVaultHandle, mergeAppJson, readJsonObject, writeJson } from "./vault.js";

/**
 * Extra content for the vault of one test, written before Obsidian starts, so a spec does not have to write files and
 * then `obsidian.reload()`. Set it with `test.use({ seed: { ... } })` in a file or a `describe`.
 */
export interface VaultSeed {
    /**
     * Files to add to the vault, by vault-relative path, with their text. They replace a file of the same path from
     * the seed vault, and folders are created. A path can point into `.obsidian/` (`.obsidian/templates.json`).
     */
    readonly files?: Readonly<Record<string, string>>;
    /** Keys merged into `.obsidian/app.json` over the seed vault's and the kit's defaults (`{ "propertiesInDocument": "hidden" }`). */
    readonly config?: Readonly<Record<string, unknown>>;
}

const KNOWN_KEYS = ["files", "config"];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Why a vault-relative path is not usable, or `null` when it is. */
export function seedPathProblem(file: string): string | null {
    if (file.trim() === "") {
        return "is empty";
    }
    if (path.isAbsolute(file) || path.win32.isAbsolute(file)) {
        return "is absolute";
    }
    if (file.endsWith("/") || file.endsWith("\\")) {
        return "ends with a slash, so it names a folder";
    }
    if (file.split(/[\\/]/).includes("..")) {
        return "leaves the vault with ..";
    }
    const normal = normalizeSeedPath(file);
    if (normal === "") {
        return "names the vault folder itself, not a file";
    }
    if (normal === ".obsidian") {
        return "names the .obsidian folder itself, not a file";
    }
    return null;
}

/** The path as the vault sees it: forward slashes, no `./`, lowercase (macOS and Windows ignore case), `""` for the vault folder. */
function normalizeSeedPath(file: string): string {
    const normal = path.posix.normalize(file.replace(/\\/g, "/")).toLowerCase();
    return normal === "." ? "" : normal.replace(/^\.\//, "");
}

/** Why a seed file must not replace what the kit writes, as a sentence naming the key to use instead; `null` when it may. */
export function seedFileConflict(file: string): string | null {
    const normal = normalizeSeedPath(file);
    if (normal === ".obsidian/app.json") {
        return 'would replace .obsidian/app.json, which the kit fills with its defaults (settingsPopoutWindow, alwaysUpdateLinks). Put the keys in seed.config, for example config: { propertiesInDocument: "hidden" }';
    }
    if (normal === ".obsidian/community-plugins.json") {
        return "would replace .obsidian/community-plugins.json, which the kit writes from the installed plugins. List the plugins in the plugins option of createObsidianTest";
    }
    if (/^\.obsidian\/plugins\/[^/]+\/data\.json$/.test(normal)) {
        return "would replace a plugin's data.json. Put the settings in the data option of createObsidianTest";
    }
    return null;
}

/** The id of the installed plugin whose folder `.obsidian/plugins/<id>/` the file is in, or `null`. */
export function seedPluginFolder(file: string, installedIds: readonly string[]): string | null {
    const match = /^\.obsidian\/plugins\/([^/]+)\//.exec(normalizeSeedPath(file));
    return installedIds.find((id) => id.toLowerCase() === match?.[1]) ?? null;
}

/**
 * Checks a seed the way a spec wrote it. `undefined` is no seed. Anything else wrong fails here with the key, so a
 * typo does not produce a vault that quietly lacks the file.
 */
export function resolveSeed(value: unknown): VaultSeed {
    if (value === undefined) {
        return {};
    }
    if (!isRecord(value)) {
        throw new Error('seed: must be an object { files?, config? }, for example test.use({ seed: { files: { "Notes/a.md": "# a" } } }).');
    }
    for (const key of Object.keys(value)) {
        if (!KNOWN_KEYS.includes(key)) {
            throw new Error(`seed: unknown key "${key}". Known keys: ${KNOWN_KEYS.join(", ")}.`);
        }
    }
    const { files, config } = value;
    if (files !== undefined) {
        if (!isRecord(files)) {
            throw new Error('seed: "files" must be an object from vault-relative path to text, for example { "Notes/a.md": "# a" }.');
        }
        for (const [file, text] of Object.entries(files)) {
            if (typeof text !== "string") {
                throw new Error(`seed: "files[${JSON.stringify(file)}]" must be a string (the file's text). For JSON, pass JSON.stringify(...).`);
            }
            const problem = seedPathProblem(file);
            if (problem !== null) {
                throw new Error(`seed: the path ${JSON.stringify(file)} ${problem}. Use a path relative to the vault, such as "Notes/a.md".`);
            }
            const conflict = seedFileConflict(file);
            if (conflict !== null) {
                throw new Error(`seed: files[${JSON.stringify(file)}] ${conflict}.`);
            }
        }
    }
    if (config !== undefined && !isRecord(config)) {
        throw new Error('seed: "config" must be an object of app.json keys, for example { propertiesInDocument: "hidden" }.');
    }
    return {
        ...(files === undefined ? {} : { files: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, String(text)])) }),
        ...(config === undefined ? {} : { config }),
    };
}

/**
 * Writes a resolved seed into the vault copy. Call it after the kit's own files, so the seed has the last word. A file
 * inside the folder of an installed plugin (`installedIds`) is refused, because it would replace the build under test.
 */
export function applySeed(vaultPath: string, seed: VaultSeed, installedIds: readonly string[] = []): void {
    for (const file of Object.keys(seed.files ?? {})) {
        const plugin = seedPluginFolder(file, installedIds);
        if (plugin !== null) {
            throw new Error(`seed: files[${JSON.stringify(file)}] is inside the folder of the installed plugin "${plugin}" and would replace its build. Seed notes and settings files elsewhere in the vault, and plugin settings with the data option of createObsidianTest.`);
        }
    }
    const vault = createVaultHandle(vaultPath);
    for (const [file, text] of Object.entries(seed.files ?? {})) {
        vault.write(file, text);
    }
    if (seed.config !== undefined && Object.keys(seed.config).length > 0) {
        const file = vault.resolve(".obsidian/app.json");
        writeJson(file, { ...mergeAppJson(readJsonObject(file)), ...seed.config });
    }
}

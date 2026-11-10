import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Defaults merged into the vault's `.obsidian/app.json` under what the seed vault already sets, so a test never
 * has to answer a prompt that nobody is there to click.
 * - `settingsPopoutWindow: false`: Settings otherwise opens in a second window on some Obsidian versions, and the
 *   page Playwright drives (and screenshots) does not show it.
 * - `alwaysUpdateLinks: true`: otherwise renaming a file shows an "Update links?" modal that blocks the file
 *   manager's update queue forever.
 */
export const APP_JSON_DEFAULTS = { settingsPopoutWindow: false, alwaysUpdateLinks: true } as const;

/** A random vault id in the shape Obsidian uses (16 hex digits). */
export function generateVaultId(): string {
    return crypto.randomBytes(8).toString("hex");
}

/** The localStorage key that marks community plugins as trusted for one vault. */
export function trustKey(vaultId: string): string {
    return `enable-plugin-${vaultId}`;
}

/**
 * The `obsidian.json` of a fresh user-data folder. Without a registered vault Obsidian opens the vault picker and
 * no workspace is ever visible. Both auto-open markers are written (`open: true` on the vault entry for current
 * versions, top-level `last_open` for older ones) and `updateDisabled` stops a self-update during the run.
 */
export function buildObsidianJson(params: { vaultId: string; vaultPath: string; now: number }): Record<string, unknown> {
    return {
        updateDisabled: true,
        last_open: params.vaultId,
        vaults: { [params.vaultId]: { path: params.vaultPath, ts: params.now, open: true } },
    };
}

/** Seed settings win; only keys the seed does not set get the default. */
export function mergeAppJson(existing: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return { ...APP_JSON_DEFAULTS, ...existing };
}

/** Copies the seed vault, resolving symlinks, so test mutations cannot reach the repository or a linked build. */
export function copySeedVault(seedVault: string, destination: string): void {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(seedVault);
    } catch (error) {
        throw new Error(
            `Seed vault ${seedVault} does not exist. Set the seedVault option (or OPDK_E2E_VAULT) to a vault folder.`,
            { cause: error },
        );
    }
    if (!stat.isDirectory()) {
        throw new Error(`Seed vault ${seedVault} is not a folder.`);
    }
    copyTreeResolveLinks(seedVault, destination, seedVault);
}

/**
 * Recursive copy that follows symlinks, so the test vault gets real copies of the plugin build and not links back
 * to the repo (which would let test mutations contaminate it). Written by hand because `fs.cpSync` with
 * `dereference: true` leaves file symlinks as links on Node 22.
 *
 * `chain` holds the real paths of the folders being copied right now. A link back to one of them would recurse
 * until the path is too long, so it is refused naming the link. A link to nothing is refused naming the seed vault.
 */
function copyTreeResolveLinks(source: string, destination: string, seedVault: string, chain: readonly string[] = []): void {
    const here = fs.realpathSync(source);
    const inProgress = [...chain, here];
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        const real = entry.isSymbolicLink() ? resolveLink(from, seedVault) : from;
        if (fs.statSync(real).isDirectory()) {
            if (inProgress.includes(fs.realpathSync(real))) {
                throw new Error(
                    `Seed vault ${seedVault} contains a symlink loop: ${from} points back to ${real}, which is already being copied. Remove the link.`,
                );
            }
            copyTreeResolveLinks(real, to, seedVault, inProgress);
        } else {
            fs.copyFileSync(real, to);
        }
    }
}

function resolveLink(link: string, seedVault: string): string {
    try {
        return fs.realpathSync(link);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            throw new Error(
                `Seed vault ${seedVault} contains a symlink that points to nothing: ${link}. Fix or remove the link.`,
                { cause: error },
            );
        }
        throw error;
    }
}

export function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/** Reads a JSON object file; `{}` when it does not exist. Throws with the path when it is not a JSON object. */
export function readJsonObject(file: string): Record<string, unknown> {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return {};
        }
        throw error;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${file} must contain a JSON object.`);
    }
    return Object.fromEntries(Object.entries(parsed));
}

export function writeUserData(params: { userDataDir: string; vaultId: string; vaultPath: string; now: number }): void {
    writeJson(path.join(params.userDataDir, "obsidian.json"), buildObsidianJson(params));
}

export function writeAppDefaults(vaultPath: string): void {
    const file = path.join(vaultPath, ".obsidian", "app.json");
    writeJson(file, mergeAppJson(readJsonObject(file)));
}

/** Read and write access to files inside the test vault, by vault-relative path. */
export interface VaultHandle {
    /** Absolute path of the per-test vault copy. */
    readonly path: string;
    /** Absolute path for a vault-relative one. Throws when it would leave the vault. */
    resolve(relativePath: string): string;
    exists(relativePath: string): boolean;
    read(relativePath: string): string;
    /** Writes the file, creating folders. */
    write(relativePath: string, content: string): void;
}

export function createVaultHandle(vaultPath: string): VaultHandle {
    const root = path.resolve(vaultPath);
    const resolve = (relativePath: string): string => {
        const target = path.resolve(root, relativePath);
        if (target !== root && !target.startsWith(root + path.sep)) {
            throw new Error(`"${relativePath}" is outside the vault (${root}). Use a path relative to the vault.`);
        }
        return target;
    };
    return {
        path: root,
        resolve,
        exists: (relativePath) => fs.existsSync(resolve(relativePath)),
        read: (relativePath) => fs.readFileSync(resolve(relativePath), "utf8"),
        write: (relativePath, content) => {
            const target = resolve(relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
        },
    };
}

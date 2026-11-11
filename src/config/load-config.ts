import { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateBuildConfig } from "../build/config.js";
import { validateDemoConfig } from "../demo/config.js";
import { validateReleaseConfig } from "../release/config.js";
import { validateScanConfig } from "../scanner/config.js";
import { CONFIG_SECTIONS, type OpdkConfig } from "./types.js";

export const CONFIG_FILE_NAME = "opdk.config.mjs";

/** Loads `<cwd>/opdk.config.mjs`. A missing file is not an error: it means "all defaults". */
export async function loadConfig(cwd: string): Promise<OpdkConfig> {
    const file = path.join(cwd, CONFIG_FILE_NAME);
    if (!isFile(file)) {
        return {};
    }
    let loaded: unknown;
    try {
        loaded = await import(pathToFileURL(file).href);
    } catch (error) {
        throw new Error(`Cannot load ${file}: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
    const exported = typeof loaded === "object" && loaded !== null && "default" in loaded ? loaded.default : undefined;
    return validateConfig(exported, file);
}

/** Checks the shape of a config value. Exported for tests and for modules that build configs in code. */
export function validateConfig(value: unknown, source: string): OpdkConfig {
    if (value === undefined) {
        throw new Error(`${source} has no default export. Use: export default defineConfig({ ... });`);
    }
    if (!isPlainObject(value)) {
        throw new Error(`${source} must export a plain object as its default export.`);
    }
    const allowed = Object.keys(CONFIG_SECTIONS);
    const unknownKeys = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknownKeys.length > 0) {
        throw new Error(
            `${source} has unknown top-level key(s): ${unknownKeys.join(", ")}. Allowed keys: ${allowed.join(", ")}.`,
        );
    }
    // Modules validate and copy their own section here when they add one.
    const build = Object.hasOwn(value, "build") ? value.build : undefined;
    const scan = Object.hasOwn(value, "scan") ? value.scan : undefined;
    const demo = Object.hasOwn(value, "demo") ? value.demo : undefined;
    const release = Object.hasOwn(value, "release") ? value.release : undefined;
    return {
        ...(build !== undefined && { build: validateBuildConfig(build, source) }),
        ...(scan !== undefined && { scan: validateScanConfig(scan, source) }),
        ...(demo !== undefined && { demo: validateDemoConfig(demo, source) }),
        ...(release !== undefined && { release: validateReleaseConfig(release, source) }),
    };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isFile(file: string): boolean {
    try {
        return statSync(file).isFile();
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

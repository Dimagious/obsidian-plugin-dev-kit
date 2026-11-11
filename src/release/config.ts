import path from "node:path";
import type { ReleaseConfig } from "../config/types.js";

const RELEASE_KEYS = ["changelog", "defaultBranch"];

/** Checks and copies the `release` section of `opdk.config.mjs`. Every error names the offending key. */
export function validateReleaseConfig(value: unknown, source: string): ReleaseConfig {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${source}: "release" must be an object.`);
    }
    const unknown = Object.keys(value).filter((key) => !RELEASE_KEYS.includes(key));
    if (unknown.length > 0) {
        throw new Error(`${source}: unknown key(s) in "release": ${unknown.join(", ")}. Allowed keys: ${RELEASE_KEYS.join(", ")}.`);
    }
    const changelog = optionalString(value, "changelog", source);
    const defaultBranch = optionalString(value, "defaultBranch", source);
    if (changelog !== undefined && (path.isAbsolute(changelog) || changelog.split(/[\\/]/).includes(".."))) {
        throw new Error(`${source}: "release.changelog" must be a path inside the plugin folder, such as "CHANGELOG.md".`);
    }
    return { ...(changelog !== undefined && { changelog }), ...(defaultBranch !== undefined && { defaultBranch }) };
}

function optionalString(record: object, key: string, source: string): string | undefined {
    const value: unknown = Object.hasOwn(record, key) ? Reflect.get(record, key) : undefined;
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || value === "") {
        throw new Error(`${source}: "release.${key}" must be a non-empty string.`);
    }
    return value;
}

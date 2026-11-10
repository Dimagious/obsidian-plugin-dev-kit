import { readFileSync } from "node:fs";
import path from "node:path";
import type { Manifest } from "./types.js";

/** Reads and validates `<cwd>/manifest.json`, the single source of the plugin id and name. */
export function readManifest(cwd: string): Manifest {
    const file = path.join(cwd, "manifest.json");
    let text: string;
    try {
        text = readFileSync(file, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            throw new Error(`No manifest.json in ${cwd}. Run opdk from the plugin root.`, { cause: error });
        }
        throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }
    return validateManifest(parsed, file);
}

function validateManifest(value: unknown, file: string): Manifest {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${file} must contain a JSON object.`);
    }
    const record = value as Record<string, unknown>;
    const id = requireString(record, "id", file);
    const name = requireString(record, "name", file);
    const version = requireString(record, "version", file);
    const minAppVersion = optionalString(record, "minAppVersion", file);
    const isDesktopOnly = optionalBoolean(record, "isDesktopOnly", file);
    return {
        id,
        name,
        version,
        ...(minAppVersion !== undefined && { minAppVersion }),
        ...(isDesktopOnly !== undefined && { isDesktopOnly }),
    };
}

function requireString(record: Record<string, unknown>, key: string, file: string): string {
    const value = ownValue(record, key);
    if (typeof value !== "string" || value === "") {
        throw new Error(`${file}: "${key}" is required and must be a non-empty string.`);
    }
    return value;
}

function optionalString(record: Record<string, unknown>, key: string, file: string): string | undefined {
    const value = ownValue(record, key);
    if (value !== undefined && typeof value !== "string") {
        throw new Error(`${file}: "${key}" must be a string when present.`);
    }
    return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string, file: string): boolean | undefined {
    const value = ownValue(record, key);
    if (value !== undefined && typeof value !== "boolean") {
        throw new Error(`${file}: "${key}" must be a boolean when present.`);
    }
    return value;
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}

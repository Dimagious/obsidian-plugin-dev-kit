import { BUILD_LOADERS, type BuildCssConfig, type BuildConfig, type BuildLoader } from "../config/types.js";

const BUILD_KEYS = ["entry", "outfile", "minify", "target", "external", "loader", "css"];
const CSS_KEYS = ["entry", "outfile"];

/** Checks and copies the `build` section of `opdk.config.mjs`. Every error names the offending key. */
export function validateBuildConfig(value: unknown, source: string): BuildConfig {
    if (!isRecord(value)) {
        throw new Error(`${source}: "build" must be an object.`);
    }
    rejectUnknownKeys(value, BUILD_KEYS, "build", source);
    const entry = optionalString(value, "entry", "build.entry", source);
    const outfile = optionalString(value, "outfile", "build.outfile", source);
    const target = optionalString(value, "target", "build.target", source);
    const minify = optionalBoolean(value, "minify", "build.minify", source);
    const external = optionalStringArray(value, "external", "build.external", source);
    const loader = optionalLoaders(value, source);
    const css = optionalCss(value, source);
    return {
        ...(entry !== undefined && { entry }),
        ...(outfile !== undefined && { outfile }),
        ...(minify !== undefined && { minify }),
        ...(target !== undefined && { target }),
        ...(external !== undefined && { external }),
        ...(loader !== undefined && { loader }),
        ...(css !== undefined && { css }),
    };
}

function optionalCss(build: Record<string, unknown>, source: string): BuildCssConfig | false | undefined {
    const value = own(build, "css");
    if (value === undefined || value === false) {
        return value;
    }
    if (!isRecord(value)) {
        throw new Error(`${source}: "build.css" must be an object ({ entry, outfile }) or false.`);
    }
    rejectUnknownKeys(value, CSS_KEYS, "build.css", source);
    const entry = optionalString(value, "entry", "build.css.entry", source);
    const outfile = optionalString(value, "outfile", "build.css.outfile", source);
    return { ...(entry !== undefined && { entry }), ...(outfile !== undefined && { outfile }) };
}

function optionalLoaders(build: Record<string, unknown>, source: string): Record<string, BuildLoader> | undefined {
    const value = own(build, "loader");
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        throw new Error(`${source}: "build.loader" must be an object such as { ".png": "dataurl" }.`);
    }
    const result: Record<string, BuildLoader> = {};
    for (const [extension, loader] of Object.entries(value)) {
        if (!extension.startsWith(".")) {
            throw new Error(`${source}: "build.loader" key "${extension}" must start with a dot, for example ".png".`);
        }
        const known = BUILD_LOADERS.find((name) => name === loader);
        if (known === undefined) {
            throw new Error(
                `${source}: "build.loader[${JSON.stringify(extension)}]" must be one of: ${BUILD_LOADERS.join(", ")}.`,
            );
        }
        result[extension] = known;
    }
    return result;
}

function optionalStringArray(
    record: Record<string, unknown>,
    key: string,
    label: string,
    source: string,
): string[] | undefined {
    const value = own(record, key);
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item !== "")) {
        throw new Error(`${source}: "${label}" must be an array of non-empty strings.`);
    }
    return value.map(String);
}

function optionalString(
    record: Record<string, unknown>,
    key: string,
    label: string,
    source: string,
): string | undefined {
    const value = own(record, key);
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || value === "") {
        throw new Error(`${source}: "${label}" must be a non-empty string.`);
    }
    return value;
}

function optionalBoolean(
    record: Record<string, unknown>,
    key: string,
    label: string,
    source: string,
): boolean | undefined {
    const value = own(record, key);
    if (value !== undefined && typeof value !== "boolean") {
        throw new Error(`${source}: "${label}" must be true or false.`);
    }
    return value;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: string[], label: string, source: string): void {
    const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        throw new Error(`${source}: unknown key(s) in "${label}": ${unknown.join(", ")}. Allowed keys: ${allowed.join(", ")}.`);
    }
}

function own(record: Record<string, unknown>, key: string): unknown {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

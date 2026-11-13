import fs from "node:fs";
import path from "node:path";
import { assertName } from "./names.js";

/** Folder under the output folder with one file per still that says how `opdk demo` treats it (`<name>.json`). */
export const STILL_OPTIONS_DIR = path.join(".owners", "still-options");

/** What the spec asked for a still beyond its pixels: where `opdk demo` puts it, if anywhere. */
export interface StillPublishing {
    /** False: the PNG stays in `<outDir>/stills` for another tool to read, and `opdk demo` does not copy it. */
    readonly publish: boolean;
    /** The key of `demo.outputs` in `opdk.config.mjs` whose folder gets the PNG instead of the default one. */
    readonly out?: string;
}

/** The treatment of a still whose spec says nothing, and of one recorded before these options existed. */
export const DEFAULT_PUBLISHING: StillPublishing = { publish: true };

/** Checks the `publish` and `out` options of `demo.still()`. Throws naming the still. */
export function resolveStillPublishing(options: { publish?: unknown; out?: unknown }, what: string): StillPublishing {
    const { publish, out } = options;
    if (publish !== undefined && typeof publish !== "boolean") {
        throw new Error(`${what}: publish must be true (copy it to the output folder) or false (keep it in the stills folder), got ${JSON.stringify(publish)}.`);
    }
    if (out === undefined) {
        return { publish: publish ?? true };
    }
    if (typeof out !== "string") {
        throw new Error(`${what}: out must be the name of a folder in demo.outputs of opdk.config.mjs, got ${JSON.stringify(out)}.`);
    }
    if (publish === false) {
        throw new Error(`${what}: out has no effect with publish: false, because the still is not copied anywhere. Remove one of them.`);
    }
    return { publish: true, out: assertName(out, `${what}: out`) };
}

export function serializeStillPublishing(value: StillPublishing): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

/** Reads the file the fixture wrote; throws a message that says what is wrong with it. */
export function parseStillPublishing(text: string, file: string): StillPublishing {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Record the still again.`, { cause: error });
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${file} must be an object { publish, out? }. Record the still again.`);
    }
    const { publish, out } = value as Record<string, unknown>;
    if (typeof publish !== "boolean" || (out !== undefined && typeof out !== "string")) {
        throw new Error(`${file} must be { "publish": boolean, "out"?: string }. Record the still again.`);
    }
    if (!publish && out !== undefined) {
        throw new Error(`${file} has "out" with "publish": false, which the fixture never writes. Record the still again.`);
    }
    return out === undefined ? { publish } : { publish, out };
}

export function writeStillPublishing(outDir: string, name: string, value: StillPublishing): void {
    const dir = path.join(outDir, STILL_OPTIONS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), serializeStillPublishing(value));
}

/** The treatment recorded for a still; the default when there is no file (a still from an earlier kit version). */
export function readStillPublishing(outDir: string, name: string): StillPublishing {
    const file = path.join(outDir, STILL_OPTIONS_DIR, `${name}.json`);
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return DEFAULT_PUBLISHING;
        }
        throw error;
    }
    return parseStillPublishing(text, file);
}

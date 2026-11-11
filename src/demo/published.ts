import fs from "node:fs";
import path from "node:path";

/** The record of media `opdk demo` wrote, in the demo output folder (`demo.outDir`). */
export const PUBLISHED_FILE = "published.json";

/** Output path (relative to the project, with `/`) to the name of the film it was encoded from. */
export type PublishedRecord = Readonly<Record<string, string>>;

const RECORD_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): unknown {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Parses the record's text; throws a message that says what is wrong with it. */
export function parsePublished(text: string): PublishedRecord {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`${PUBLISHED_FILE} is not valid JSON (${error instanceof Error ? error.message : String(error)})`, { cause: error });
    }
    const listed = isRecord(data) ? own(data, "files") : undefined;
    if (!isRecord(data) || own(data, "version") !== RECORD_VERSION || !isRecord(listed)) {
        throw new Error(`${PUBLISHED_FILE} is not a version ${String(RECORD_VERSION)} record of { "files": { "<path>": "<film>" } }`);
    }
    const files: Record<string, string> = {};
    for (const [file, film] of Object.entries(listed)) {
        if (typeof film !== "string" || film === "") {
            throw new Error(`${PUBLISHED_FILE}: the entry for "${file}" must be a film name`);
        }
        files[file] = film;
    }
    return files;
}

export function serializePublished(record: PublishedRecord): string {
    const files = Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
    return `${JSON.stringify({ version: RECORD_VERSION, files }, null, 2)}\n`;
}

/**
 * The record after a run: entries whose file is gone from disk are dropped (the owner deleted an obsolete file, so it
 * must not be named again), and the files this run wrote are added or re-pointed at their film.
 */
export function updatePublished(previous: PublishedRecord, written: PublishedRecord, exists: (file: string) => boolean): PublishedRecord {
    const next: Record<string, string> = {};
    for (const [file, film] of Object.entries(previous)) {
        if (exists(file)) {
            next[file] = film;
        }
    }
    return { ...next, ...written };
}

export function sameRecord(a: PublishedRecord, b: PublishedRecord): boolean {
    const left = Object.entries(a);
    return left.length === Object.keys(b).length && left.every(([file, film]) => b[file] === film);
}

/** Reads the record; a missing file is an empty record (the kit has published nothing yet), anything else wrong throws. */
export function readPublished(outDir: string): PublishedRecord {
    let text: string;
    try {
        text = fs.readFileSync(path.join(outDir, PUBLISHED_FILE), "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return {};
        }
        throw error;
    }
    return parsePublished(text);
}

export function writePublished(outDir: string, record: PublishedRecord): void {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, PUBLISHED_FILE), serializePublished(record));
}

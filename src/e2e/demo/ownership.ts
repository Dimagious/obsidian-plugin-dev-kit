import fs from "node:fs";
import path from "node:path";

/** The file in a film's folder that says which test wrote the film in which run. */
export const OWNER_FILE = "owner.json";
/** The folder of stills under the demo output folder (`<outDir>/stills/<name>.png`). */
export const STILLS_DIR = "stills";
/** Folder under the output folder with one such file per still, so `stills/` holds pictures only. */
export const STILL_OWNERS_DIR = path.join(".owners", "stills");

/** Who wrote a film or a still: the test and the run (one `playwright test` invocation). */
export interface Owner {
    readonly testId: string;
    readonly runId: string;
    /** For the message only. */
    readonly title: string;
}

export function serializeOwner(owner: Owner): string {
    return `${JSON.stringify(owner, null, 2)}\n`;
}

/** Reads a marker; text that is not a marker gives null, so a damaged file never blocks a retake. */
export function parseOwner(text: string): Owner | null {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    const { testId, runId, title } = value as Record<string, unknown>;
    return typeof testId === "string" && typeof runId === "string" && typeof title === "string" ? { testId, runId, title } : null;
}

/**
 * Two tests that end up with the same name would silently replace each other's pictures; the run then publishes
 * whichever finished last. A marker from an earlier run is a retake and is replaced; so is one from the same test (a retry).
 */
export function assertNotOwnedByAnotherTest(existing: Owner | null, current: Owner, what: string): void {
    if (existing !== null && existing.runId === current.runId && existing.testId !== current.testId) {
        throw new Error(
            `${what} was already written in this run by another test ("${existing.title}"). ` +
                `Two tests with the same name would replace each other's pictures; pass a different name in one of them.`,
        );
    }
}

function readOwner(file: string): Owner | null {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
    return parseOwner(text);
}

/** Fails when another test of this run owns the film folder `dir`. Call before the folder is emptied. */
export function assertFilmFree(dir: string, current: Owner, what: string): void {
    assertNotOwnedByAnotherTest(readOwner(path.join(dir, OWNER_FILE)), current, what);
}

export function writeFilmOwner(dir: string, owner: Owner): void {
    fs.writeFileSync(path.join(dir, OWNER_FILE), serializeOwner(owner));
}

/** Fails when another test of this run wrote the still `name` under the output folder `outDir`. */
export function assertStillFree(outDir: string, name: string, current: Owner, what: string): void {
    assertNotOwnedByAnotherTest(readOwner(path.join(outDir, STILL_OWNERS_DIR, `${name}.json`)), current, what);
}

export function writeStillOwner(outDir: string, name: string, owner: Owner): void {
    const dir = path.join(outDir, STILL_OWNERS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.json`), serializeOwner(owner));
}

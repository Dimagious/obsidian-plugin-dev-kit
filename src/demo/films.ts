import fs from "node:fs";
import path from "node:path";
import { MANIFEST_FILE, parseFilmManifest, type FilmFrame, type FilmManifest } from "../e2e/demo/manifest.js";
import { readPngSize } from "../e2e/demo/png.js";

/** The folder of films under the demo output folder. */
export const FILMS_DIR = "films";

export interface FoundFilm {
    readonly name: string;
    /** Absolute folder of the film's frames and manifest. */
    readonly dir: string;
    readonly manifest: FilmManifest;
}

/** A film folder that cannot be encoded now, and why. */
export interface SkippedFilm {
    readonly name: string;
    readonly reason: string;
}

export interface FilmListing {
    readonly complete: readonly FoundFilm[];
    readonly incomplete: readonly SkippedFilm[];
    /** Folders whose manifest is missing or unreadable: not a film the kit can name, so a problem rather than a skip. */
    readonly broken: readonly SkippedFilm[];
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Why a manifest that parsed cannot be encoded, or null when it can. */
export function incompleteReason(manifest: FilmManifest): string | null {
    if (!manifest.complete) {
        return "its recording did not finish (the test is still running, or it failed); run the spec again";
    }
    if (manifest.frames.length === 0) {
        return "it has no frames; call film.shot() in the test";
    }
    return null;
}

/**
 * Reads `<outDir>/films/*`/manifest.json. `owner.json` and `.owners/` are the recorder's bookkeeping and are never read.
 * A missing `films` folder is an empty listing, not an error: the caller says what to do about it.
 */
export function listFilms(outDir: string): FilmListing {
    const root = path.join(outDir, FILMS_DIR);
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (error) {
        if (isMissing(error)) {
            return { complete: [], incomplete: [], broken: [] };
        }
        throw error;
    }
    const complete: FoundFilm[] = [];
    const incomplete: SkippedFilm[] = [];
    const broken: SkippedFilm[] = [];
    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        const dir = path.join(root, entry.name);
        let text: string;
        try {
            text = fs.readFileSync(path.join(dir, MANIFEST_FILE), "utf8");
        } catch (error) {
            if (!isMissing(error)) {
                throw error;
            }
            broken.push({ name: entry.name, reason: `${MANIFEST_FILE} is missing (an interrupted recording, or a folder that is not a film)` });
            continue;
        }
        let manifest: FilmManifest;
        try {
            manifest = parseFilmManifest(text);
        } catch (error) {
            broken.push({ name: entry.name, reason: error instanceof Error ? error.message : String(error) });
            continue;
        }
        if (manifest.name !== entry.name) {
            broken.push({ name: entry.name, reason: `${MANIFEST_FILE} says the film is "${manifest.name}", not the folder name; do not rename film folders` });
            continue;
        }
        const reason = incompleteReason(manifest);
        if (reason === null) {
            complete.push({ name: entry.name, dir, manifest });
        } else {
            incomplete.push({ name: entry.name, reason });
        }
    }
    return { complete, incomplete, broken };
}

/**
 * Moves a finished file into place. A rename replaces the old file in one step; across volumes (the work folder in
 * the temp folder, the output in a project on another disk) a rename is impossible, so the file is copied next to its
 * destination first and renamed from there, and the old file still stays whole until the new one is complete.
 */
export function moveFile(from: string, to: string): void {
    try {
        fs.renameSync(from, to);
        return;
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EXDEV")) {
            throw error;
        }
    }
    const partial = `${to}.opdk-partial`;
    try {
        fs.copyFileSync(from, partial);
        fs.renameSync(partial, to);
    } finally {
        fs.rmSync(partial, { force: true });
        fs.rmSync(from, { force: true });
    }
}

const PNG_HEADER_BYTES = 24;

/** Pixel size of a PNG from its first bytes, without reading the picture. */
export function readPngFileSize(file: string): { width: number; height: number } {
    const fd = fs.openSync(file, "r");
    try {
        const header = Buffer.alloc(PNG_HEADER_BYTES);
        const read = fs.readSync(fd, header, 0, PNG_HEADER_BYTES, 0);
        return readPngSize(header.subarray(0, read));
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Fails when a frame file is missing or is not `expected` pixels. The encoder needs one size, and a frame that is
 * gone or stale would otherwise show up as a cryptic ffmpeg error or a film with a jump in it.
 */
export function assertFrameFiles(dir: string, frames: readonly FilmFrame[], expected: { width: number | null; height: number | null }): void {
    for (const frame of frames) {
        const file = path.join(dir, frame.file);
        let size: { width: number; height: number };
        try {
            size = readPngFileSize(file);
        } catch (error) {
            if (isMissing(error)) {
                throw new Error(`frame ${frame.file} is missing from ${dir}. Run the spec again to record the film.`, { cause: error });
            }
            throw new Error(`frame ${frame.file} is not a readable PNG: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
        if (size.width !== expected.width || size.height !== expected.height) {
            throw new Error(
                `frame ${frame.file} is ${String(size.width)} x ${String(size.height)} px but the manifest says ${String(expected.width)} x ${String(expected.height)}. ` +
                    `The frames and the manifest come from different recordings; run the spec again.`,
            );
        }
    }
}

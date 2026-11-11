import fs from "node:fs";
import path from "node:path";
import { STILLS_DIR } from "../e2e/demo/ownership.js";

/**
 * The record and the stale check name the owner of an output file by a film name. A still gets `still:<name>`: a film
 * name is a folder name and cannot hold a colon, so a still never shares its key with a film of the same name.
 */
export function stillKey(name: string): string {
    return `still:${name}`;
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The names of the PNGs in `<outDir>/stills`, sorted. A missing folder is no stills. */
export function listStills(outDir: string): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(path.join(outDir, STILLS_DIR), { withFileTypes: true });
    } catch (error) {
        if (isMissing(error)) {
            return [];
        }
        throw error;
    }
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
        .map((entry) => entry.name.slice(0, -".png".length))
        .sort((a, b) => a.localeCompare(b));
}

export interface PublishedStill {
    readonly name: string;
    /** Absolute path of the file in the output folder. */
    readonly file: string;
    /** False when the file there already had the same bytes and was left alone. */
    readonly copied: boolean;
    readonly bytes: number;
}

/**
 * Puts `<outDir>/stills/<name>.png` into `folder` as `<name>.png`, unless the file there already has the same bytes,
 * so a retake of an unchanged picture does not touch the file (and shows no change in git). The copy goes to a
 * temporary name next to the destination and is renamed, so a failed copy leaves the previous picture whole.
 */
export function publishStill(outDir: string, name: string, folder: string): PublishedStill {
    const source = path.join(outDir, STILLS_DIR, `${name}.png`);
    const file = path.join(folder, `${name}.png`);
    const bytes = fs.readFileSync(source);
    let current: Buffer | undefined;
    try {
        current = fs.readFileSync(file);
    } catch (error) {
        if (!isMissing(error)) {
            throw error;
        }
    }
    if (current?.equals(bytes) === true) {
        return { name, file, copied: false, bytes: bytes.length };
    }
    fs.mkdirSync(folder, { recursive: true });
    const partial = `${file}.opdk-partial`;
    try {
        fs.writeFileSync(partial, bytes);
        fs.renameSync(partial, file);
    } finally {
        fs.rmSync(partial, { force: true });
    }
    return { name, file, copied: true, bytes: bytes.length };
}

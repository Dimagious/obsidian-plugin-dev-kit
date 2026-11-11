import type { FilmFrame, FilmManifest } from "../e2e/demo/manifest.js";

/** `340 KB`, or `1.4 MB` from a megabyte up (1 KB = 1024 bytes, like the budgets). */
export function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export type BudgetVerdict = "ok" | "warn" | "fail";

/** A file is over budget when it is larger than the limit; exactly the limit is fine. */
export function budgetVerdict(bytes: number, budget: { warnBytes: number; failBytes: number }): BudgetVerdict {
    if (bytes > budget.failBytes) {
        return "fail";
    }
    return bytes > budget.warnBytes ? "warn" : "ok";
}

export interface StaleOutputs {
    /** Recorded files whose film has no manifest any more (renamed or deleted test). */
    readonly goneFilms: string[];
    /** Recorded files of a film that still exists and encoded cleanly this run without writing them (an output turned off, or moved). */
    readonly notWritten: string[];
}

/**
 * Media the kit published earlier (`published`: output path to film name, from the record) that is still on disk and
 * that no film produces any more: its film has no manifest (`currentFilms` lists the films that do), or its film
 * encoded without failures in this run (`encoded`) and did not write it (`written`: output path to film name). A film
 * that failed or was not selected proves nothing about its files. Sorted; nothing is deleted. Files the kit never wrote
 * are not in the record, so pictures that merely share the folder are never named.
 */
export function findStaleOutputs(
    published: Readonly<Record<string, string>>,
    currentFilms: ReadonlySet<string>,
    exists: (file: string) => boolean,
    current: { readonly encoded: ReadonlySet<string>; readonly written: Readonly<Record<string, string>> },
): StaleOutputs {
    const goneFilms: string[] = [];
    const notWritten: string[] = [];
    for (const [file, film] of Object.entries(published)) {
        if (!exists(file)) {
            continue;
        }
        if (!currentFilms.has(film)) {
            goneFilms.push(file);
        } else if (current.encoded.has(film) && !Object.hasOwn(current.written, file)) {
            notWritten.push(file);
        }
    }
    return { goneFilms: goneFilms.sort(), notWritten: notWritten.sort() };
}

/** Problems with the pixel density a film was shot at, from its manifest alone. */
export function densityWarnings(manifest: FilmManifest): string[] {
    const warnings: string[] = [];
    if (manifest.scale < 2) {
        warnings.push(
            `shot at scale ${String(manifest.scale)}: on a Retina screen the film is shown at twice its size and looks soft. Shoot at scale 2 (the demo fixture's default).`,
        );
    }
    const { width, height } = manifest;
    if (width !== null && height !== null && (width % manifest.scale !== 0 || height % manifest.scale !== 0)) {
        warnings.push(
            `frames are ${String(width)} x ${String(height)} px, not a whole number of CSS pixels at scale ${String(manifest.scale)}: ` +
                `the manifest's scale does not match the pictures.`,
        );
    }
    return warnings;
}

/** How many frames the warning for short holds names before it says "and N more". */
const MAX_NAMED_FRAMES = 5;

/**
 * Frames that are shown for less than one GIF frame (`1 / gifFps` seconds). The GIF samples the film at its fps, so
 * such a frame can be skipped and the step is missing from the GIF. Null when every frame is held long enough.
 */
export function shortHoldWarning(frames: readonly FilmFrame[], gifFps: number): string | null {
    const frameSeconds = 1 / gifFps;
    // A hold of exactly one GIF frame is fine; the epsilon keeps 0.1 s at 10 fps from failing on float error.
    const short = frames.filter((frame) => frame.hold < frameSeconds - 1e-9);
    if (short.length === 0) {
        return null;
    }
    const named = short.slice(0, MAX_NAMED_FRAMES).map((frame) => `${frame.file} (${String(frame.hold)} s)`);
    const more = short.length > named.length ? ` and ${String(short.length - named.length)} more` : "";
    return (
        `frame${short.length === 1 ? "" : "s"} ${named.join(", ")}${more} ${short.length === 1 ? "is" : "are"} held for less than one GIF frame ` +
        `(${frameSeconds.toFixed(2)} s at ${String(gifFps)} fps), so the GIF can skip ${short.length === 1 ? "it" : "them"}. Hold ${short.length === 1 ? "it" : "them"} longer, or raise gif.fps.`
    );
}

/** Where two RGBA pictures of the same size differ. */
export interface FrameDifference {
    /** Top-left corner of the box around every differing pixel, in frame pixels. */
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    /** Share of differing pixels, 0 to 1. */
    readonly ratio: number;
}

/**
 * Largest difference per colour channel (of 255) that still counts as the same pixel. Video-grade antialiasing and
 * compositing noise (a caret fade, a subpixel shift of text) stays within a few shades; Dashy's loop differed by 0.9%
 * of the pixels at one shade and looked identical. 8 is invisible to the eye and far below a real change (a changed
 * label, a toggled control, a moved highlight differ by dozens of shades).
 */
export const CHANNEL_TOLERANCE = 8;

/**
 * Compares two raw RGBA buffers of `width` x `height`; null when every pixel matches within `tolerance` per channel
 * (alpha included). Differences above it are reported as a box and a share, as before.
 */
export function compareFrames(a: Buffer, b: Buffer, width: number, height: number, tolerance: number = CHANNEL_TOLERANCE): FrameDifference | null {
    const size = width * height * 4;
    if (a.length !== size || b.length !== size) {
        throw new Error(`Cannot compare frames: expected ${String(size)} bytes of ${String(width)} x ${String(height)} RGBA, got ${String(a.length)} and ${String(b.length)}.`);
    }
    if (a.equals(b)) {
        return null;
    }
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            if (pixelsDiffer(a, b, at, tolerance)) {
                count++;
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
    }
    if (count === 0) {
        return null;
    }
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, ratio: count / (width * height) };
}

function pixelsDiffer(a: Buffer, b: Buffer, at: number, tolerance: number): boolean {
    for (let channel = 0; channel < 4; channel++) {
        if (Math.abs((a[at + channel] ?? 0) - (b[at + channel] ?? 0)) > tolerance) {
            return true;
        }
    }
    return false;
}

export function describeLoopDifference(difference: FrameDifference): string {
    const percent = difference.ratio * 100;
    const share = percent < 0.1 ? "under 0.1" : percent.toFixed(1);
    return (
        `loop does not close: the last frame differs from the first in a ${String(difference.width)} x ${String(difference.height)} px area at ` +
        `(${String(difference.x)}, ${String(difference.y)}), ${share}% of the pixels. The GIF jumps when it repeats. ` +
        `End the scene where it began, or set demo.loop to "off" if the jump is intended.`
    );
}

import type { Size } from "./clip.js";
import type { ThemeMode } from "./names.js";

/** Bumped when the manifest layout changes incompatibly; `opdk demo` refuses a version it does not know. */
export const MANIFEST_VERSION = 1;
/** The file name of a film's manifest inside the film's folder. */
export const MANIFEST_FILE = "manifest.json";
/** Frames per second the film is encoded at unless the film says otherwise. */
export const DEFAULT_FPS = 15;
const MAX_FPS = 60;

export type FilmKind = "desktop" | "phone";

/** One picture of a film and how long the viewer sees it. */
export interface FilmFrame {
    /** Relative to the film's folder. */
    readonly file: string;
    /** Seconds. */
    readonly hold: number;
    /** Index into `captions`, or null when the frame has no caption beside it. */
    readonly caption: number | null;
}

/** The test that recorded a film, so a later step can list the films whose test no longer exists. */
export interface FilmSource {
    /** Playwright's id of the test. */
    readonly testId: string;
    /** Describe titles and test title, joined with spaces. */
    readonly title: string;
    /** The spec file, relative to the directory `playwright test` ran in, with forward slashes. */
    readonly file: string;
}

/** What a film recorded, as written to `<outDir>/films/<name>/manifest.json`. */
export interface FilmManifest {
    readonly version: typeof MANIFEST_VERSION;
    readonly name: string;
    readonly kind: FilmKind;
    readonly fps: number;
    /** Device pixels per CSS pixel the frames were shot at. */
    readonly scale: number;
    /** The colour scheme `demo.themes()` shot this film in, or null outside it. */
    readonly theme: ThemeMode | null;
    /** Text for the caption list a composed phone film shows beside the phone; not drawn into the frames. */
    readonly captions: readonly string[];
    /** Pixel size of every frame; null until the first frame is shot. */
    readonly width: number | null;
    readonly height: number | null;
    /** False while the film records and when its test failed, so a half film is never encoded by mistake. */
    readonly complete: boolean;
    readonly frames: readonly FilmFrame[];
    /** The recording test; absent in a manifest written by an older kit. */
    readonly source?: FilmSource;
}

export function newManifest(params: {
    name: string;
    kind: FilmKind;
    fps: number;
    scale: number;
    theme: ThemeMode | null;
    captions: readonly string[];
    source?: FilmSource;
}): FilmManifest {
    return { version: MANIFEST_VERSION, ...params, width: null, height: null, complete: false, frames: [] };
}

/** `0001.png`: sorts in shot order up to 9999 frames, which a film of stills never approaches. */
export function frameFileName(index: number): string {
    return `${String(index + 1).padStart(4, "0")}.png`;
}

/** The most `beat()` accepts: longer is almost surely milliseconds passed where seconds are meant. */
export const MAX_BEAT_SECONDS = 60;

export function assertKind(kind: unknown): FilmKind {
    if (kind !== "desktop" && kind !== "phone") {
        throw new Error(`film(): kind must be "desktop" or "phone", got ${JSON.stringify(kind)}.`);
    }
    return kind;
}

export function assertFps(fps: number | undefined, what = "film()"): number {
    const value = fps ?? DEFAULT_FPS;
    if (!Number.isInteger(value) || value < 1 || value > MAX_FPS) {
        throw new Error(`${what}: fps must be a whole number from 1 to ${String(MAX_FPS)}, got ${String(value)}.`);
    }
    return value;
}

export function assertScale(scale: number, what: string): number {
    if (!Number.isInteger(scale) || scale < 1 || scale > 4) {
        throw new Error(`${what}: scale must be a whole number from 1 to 4, got ${String(scale)}.`);
    }
    return scale;
}

export function assertCaptions(captions: unknown): readonly string[] {
    if (captions === undefined) {
        return [];
    }
    if (!Array.isArray(captions)) {
        throw new Error("film(): captions must be an array of strings.");
    }
    const list: string[] = [];
    for (const caption of captions as unknown[]) {
        if (typeof caption !== "string") {
            throw new Error("film(): captions must be an array of strings.");
        }
        list.push(caption);
    }
    return list;
}

export function assertHold(hold: number): number {
    if (!Number.isFinite(hold) || hold <= 0) {
        throw new Error(`shot(): hold is how many seconds the frame stays on screen and must be above 0, got ${String(hold)}.`);
    }
    return hold;
}

/** The caption index of a shot, or null. An index outside `captions` is a typo in the spec, so it fails. */
export function resolveCaptionIndex(caption: number | undefined, captions: readonly string[]): number | null {
    if (caption === undefined) {
        return null;
    }
    if (!Number.isInteger(caption) || caption < 0 || caption >= captions.length) {
        throw new Error(
            `shot(): caption ${String(caption)} is not an index of the film's captions (${String(captions.length)} given, so 0..${String(captions.length - 1)}). ` +
                `Pass the texts as the captions option of film().`,
        );
    }
    return caption;
}

/**
 * Adds a frame. The first frame fixes the pixel size; every later one must have the same, because the encoder needs
 * one size (a clip that follows an element which resizes would otherwise produce a film that cannot be encoded).
 */
export function addFrame(manifest: FilmManifest, frame: FilmFrame, size: Size): FilmManifest {
    if (manifest.width !== null && manifest.height !== null && (manifest.width !== size.width || manifest.height !== size.height)) {
        throw new Error(
            `film "${manifest.name}": frame ${String(manifest.frames.length + 1)} is ${String(size.width)} x ${String(size.height)} px but the first frame is ` +
                `${String(manifest.width)} x ${String(manifest.height)}. A film needs one size: clip a fixed rectangle, or a target that does not resize.`,
        );
    }
    return { ...manifest, width: size.width, height: size.height, frames: [...manifest.frames, frame] };
}

export function serializeManifest(manifest: FilmManifest): string {
    return `${JSON.stringify(manifest, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FRAME_FILE = /^\d{4,}\.png$/;

function parseFrame(value: unknown, index: number, captionCount: number): FilmFrame {
    if (!isRecord(value) || typeof value.file !== "string" || typeof value.hold !== "number" || !(value.caption === null || typeof value.caption === "number")) {
        throw new Error(`Film manifest: frames[${String(index)}] must be { file: string, hold: number, caption: number | null }.`);
    }
    // The file is joined to the film's folder by whoever reads the manifest, so it must stay a plain frame name.
    if (!FRAME_FILE.test(value.file)) {
        throw new Error(`Film manifest: frames[${String(index)}].file ${JSON.stringify(value.file)} must be a frame name such as 0001.png.`);
    }
    if (!Number.isFinite(value.hold) || value.hold <= 0) {
        throw new Error(`Film manifest: frames[${String(index)}].hold must be seconds above 0, got ${String(value.hold)}.`);
    }
    if (value.caption !== null && (!Number.isInteger(value.caption) || value.caption < 0 || value.caption >= captionCount)) {
        throw new Error(`Film manifest: frames[${String(index)}].caption ${String(value.caption)} is not an index of captions (${String(captionCount)} given).`);
    }
    return { file: value.file, hold: value.hold, caption: value.caption };
}

function parseSource(value: unknown): FilmSource | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value) || typeof value.testId !== "string" || typeof value.title !== "string" || typeof value.file !== "string") {
        throw new Error("Film manifest: source must be { testId: string, title: string, file: string }.");
    }
    return { testId: value.testId, title: value.title, file: value.file };
}

/** Reads a manifest written by `serializeManifest`; fails naming the first field that is wrong. */
export function parseFilmManifest(text: string): FilmManifest {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new Error(`Film manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (!isRecord(value)) {
        throw new Error("Film manifest must be a JSON object.");
    }
    if (value.version !== MANIFEST_VERSION) {
        throw new Error(`Film manifest version ${JSON.stringify(value.version)} is not supported (this kit reads version ${String(MANIFEST_VERSION)}).`);
    }
    const { name, kind, fps, scale, theme, captions, width, height, complete, frames } = value;
    if (typeof name !== "string" || typeof fps !== "number" || typeof scale !== "number" || typeof complete !== "boolean") {
        throw new Error("Film manifest needs name (string), fps (number), scale (number) and complete (boolean).");
    }
    if (theme !== null && theme !== "light" && theme !== "dark") {
        throw new Error('Film manifest: theme must be "light", "dark" or null.');
    }
    const captionList: string[] = [];
    if (!Array.isArray(captions)) {
        throw new Error("Film manifest: captions must be an array of strings.");
    }
    for (const caption of captions as unknown[]) {
        if (typeof caption !== "string") {
            throw new Error("Film manifest: captions must be an array of strings.");
        }
        captionList.push(caption);
    }
    if (!(width === null || typeof width === "number") || !(height === null || typeof height === "number")) {
        throw new Error("Film manifest: width and height must be numbers or null.");
    }
    if (!Array.isArray(frames)) {
        throw new Error("Film manifest: frames must be an array.");
    }
    if (frames.length > 0 && (typeof width !== "number" || typeof height !== "number")) {
        throw new Error("Film manifest: a film with frames needs width and height (numbers).");
    }
    const source = parseSource(value.source);
    return {
        version: MANIFEST_VERSION,
        name,
        kind: assertKind(kind),
        fps: assertFps(fps, "Film manifest"),
        scale: assertScale(scale, "Film manifest"),
        theme,
        captions: captionList,
        width,
        height,
        complete,
        frames: (frames as unknown[]).map((frame, index) => parseFrame(frame, index, captionList.length)),
        ...(source === undefined ? {} : { source }),
    };
}

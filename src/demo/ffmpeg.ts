import path from "node:path";
import type { FilmFrame } from "../e2e/demo/manifest.js";

/** Environment variable that points `opdk demo` at an ffmpeg binary (a build with libx264, say) instead of the one on PATH. */
export const FFMPEG_ENV = "OPDK_FFMPEG";

export const INSTALL_HINT =
    `Install ffmpeg (macOS: brew install ffmpeg; Debian or Ubuntu: sudo apt install ffmpeg; Windows: winget install ffmpeg) ` +
    `and make sure it is on PATH, or set ${FFMPEG_ENV} to the binary.`;

/** What running `<command> -version` tells; `error` is set when the command could not run. */
export interface FfmpegProbe {
    readonly ok: boolean;
    /** First line of the version output. */
    readonly version?: string;
    readonly error?: string;
}

/** Picks the ffmpeg command: `OPDK_FFMPEG` when set (and then it must work), otherwise `ffmpeg` from PATH. */
export async function locateFfmpeg(
    env: Readonly<Record<string, string | undefined>>,
    probe: (command: string) => Promise<FfmpegProbe>,
): Promise<{ command: string; version: string }> {
    const fromEnv = env[FFMPEG_ENV];
    const explicit = fromEnv !== undefined && fromEnv !== "";
    const command = explicit ? fromEnv : "ffmpeg";
    const result = await probe(command);
    if (result.ok) {
        return { command, version: result.version ?? command };
    }
    if (explicit) {
        throw new Error(`${FFMPEG_ENV}=${fromEnv} cannot run (${result.error ?? "unknown error"}). Point it at a working ffmpeg binary or unset it to use PATH.`);
    }
    throw new Error(`ffmpeg was not found on PATH (${result.error ?? "unknown error"}). ${INSTALL_HINT}`);
}

/** Single quotes in a concat list file are escaped as `'\''`. */
function quoteConcatPath(file: string): string {
    return `'${file.replaceAll("'", "'\\''")}'`;
}

/** Seconds the film runs: the sum of the frame holds. */
export function totalHold(frames: readonly FilmFrame[]): number {
    return frames.reduce((sum, frame) => sum + frame.hold, 0);
}

/**
 * The concat demuxer list for a film: each frame with its own `duration`.
 *
 * The demuxer ignores the duration of the last entry unless that file is listed once more after it, so the last
 * frame is repeated. The repeat plays the whole last hold a second time (holds of 1 s and 2 s run 5 s; without the
 * repeat the last hold is not honoured), which is why the encodes also pass `-t <total hold>`: it cuts the film
 * back to the sum of the holds.
 */
export function buildConcatList(dir: string, frames: readonly FilmFrame[]): string {
    const last = frames.at(-1);
    if (last === undefined) {
        throw new Error("Cannot build a film from zero frames.");
    }
    const lines = ["ffconcat version 1.0"];
    for (const frame of frames) {
        lines.push(`file ${quoteConcatPath(path.join(dir, frame.file))}`, `duration ${frame.hold.toFixed(3)}`);
    }
    lines.push(`file ${quoteConcatPath(path.join(dir, last.file))}`);
    return `${lines.join("\n")}\n`;
}

const COMMON = ["-hide_banner", "-v", "error", "-y"] as const;

/**
 * Reads the next input as one picture. Left to itself ffmpeg treats a `%d` in a path as a numbered sequence, and the
 * option `-pattern_type` only exists on the image2 demuxer, which ffmpeg would not pick for a PNG on its own.
 */
const SINGLE_IMAGE = ["-f", "image2", "-pattern_type", "none"] as const;

function concatInput(list: string, frames: readonly FilmFrame[]): string[] {
    return ["-f", "concat", "-safe", "0", "-i", list, "-t", totalHold(frames).toFixed(3)];
}

/** MP4 for the web: x264, yuv420p (the only format every browser and phone plays), even dimensions, moov atom first. */
export function mp4Args(params: { list: string; frames: readonly FilmFrame[]; fps: number; out: string }): string[] {
    return [
        ...COMMON,
        ...concatInput(params.list, params.frames),
        "-vf",
        `fps=${String(params.fps)},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-preset",
        "slow",
        "-movflags",
        "+faststart",
        "-an",
        params.out,
    ];
}

/** GIF with its own palette: `stats_mode=diff` spends colours on what moves, bayer dithering stays small on flat UI. */
export function gifArgs(params: { list: string; frames: readonly FilmFrame[]; fps: number; width: number; colors: number; out: string }): string[] {
    const filter =
        `fps=${String(params.fps)},scale=${String(params.width)}:-1:flags=lanczos,split[a][b];` +
        `[a]palettegen=max_colors=${String(params.colors)}:stats_mode=diff[p];` +
        `[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    return [...COMMON, ...concatInput(params.list, params.frames), "-vf", filter, "-loop", "0", params.out];
}

/** The poster: the first frame at `width`. `-update 1` writes the output as one picture even when its path has a `%d`. */
export function posterArgs(params: { frame: string; width: number; out: string }): string[] {
    return [...COMMON, ...SINGLE_IMAGE, "-i", params.frame, "-vf", `scale=${String(params.width)}:-1:flags=lanczos`, "-frames:v", "1", "-update", "1", params.out];
}

/** Decodes one picture to raw RGBA on stdout, for comparing pixels. */
export function rawFrameArgs(frame: string): string[] {
    return [...COMMON, ...SINGLE_IMAGE, "-i", frame, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"];
}

/** The last non-empty lines of ffmpeg's stderr, where it says what went wrong. */
export function stderrTail(stderr: string, lines = 8): string {
    return stderr
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .slice(-lines)
        .join("\n");
}

/** GIF width: the configured one, else the frame width capped at `maxAuto`; never above the frame width. */
export function resolveGifWidth(configured: number | null, frameWidth: number, maxAuto: number): { width: number; clamped: boolean } {
    if (configured === null) {
        return { width: Math.min(frameWidth, maxAuto), clamped: false };
    }
    return configured > frameWidth ? { width: frameWidth, clamped: true } : { width: configured, clamped: false };
}

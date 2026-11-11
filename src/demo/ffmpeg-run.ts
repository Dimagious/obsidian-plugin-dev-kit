import { execFile } from "node:child_process";
import { stderrTail, type FfmpegProbe } from "./ffmpeg.js";

/** What the demo run needs from ffmpeg; tests replace it. */
export interface FfmpegTool {
    /** The command that runs, for messages. */
    readonly command: string;
    /** Runs ffmpeg; a non-zero exit, or any error it prints, throws with the tail of its stderr. */
    run(args: readonly string[]): Promise<void>;
    /** Runs ffmpeg and returns what it wrote to stdout. */
    capture(args: readonly string[]): Promise<Buffer>;
    /** The text of `ffmpeg -encoders`. */
    encoders(): Promise<string>;
}

/** Large enough for a few 4K RGBA frames; ffmpeg's own diagnostics are small. */
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

/** An encode of a long film at 2x takes a minute or two; ten minutes means ffmpeg is stuck (a pipe nobody reads, a dead disk). */
export const ENCODE_TIMEOUT_MS = 10 * 60 * 1000;
/** `-version` and `-encoders` answer at once. */
const PROBE_TIMEOUT_MS = 30 * 1000;

/**
 * `strict` also fails a run that exited 0 but printed to stderr. The encodes run at `-v error`, so stderr holds
 * errors only, and ffmpeg is known to exit 0 after it skipped a frame it could not decode (a truncated PNG),
 * which would ship a film with a missing step.
 */
function exec(command: string, args: readonly string[], timeoutMs: number, strict = false): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const options = { encoding: "buffer", maxBuffer: MAX_OUTPUT_BYTES, timeout: timeoutMs, killSignal: "SIGKILL" } as const;
        execFile(command, [...args], options, (error, stdout, stderr) => {
            if (error === null) {
                const tail = stderrTail(stderr.toString("utf8"));
                if (strict && tail !== "") {
                    reject(new Error(`${command} exited with code 0 but reported errors:\n${tail}`));
                    return;
                }
                resolve(stdout);
                return;
            }
            const code: unknown = (error as NodeJS.ErrnoException).code;
            const tail = stderrTail(stderr.toString("utf8"));
            const timedOut = error.killed && error.signal === "SIGKILL";
            const how = timedOut
                ? `did not finish in ${String(timeoutMs / 1000)} s and was killed`
                : typeof code === "number"
                  ? `exited with code ${String(code)}`
                  : `could not run (${error.message})`;
            reject(new Error(`${command} ${how}${tail === "" ? "." : `:\n${tail}`}`, { cause: error }));
        });
    });
}

/** Whether `<command> -version` runs. */
export async function probeFfmpeg(command: string): Promise<FfmpegProbe> {
    try {
        const stdout = await exec(command, ["-hide_banner", "-version"], PROBE_TIMEOUT_MS);
        return { ok: true, version: stdout.toString("utf8").split("\n")[0]?.trim() ?? command };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error) };
    }
}

/** `timeoutMs` bounds every encode; the default is `ENCODE_TIMEOUT_MS`. */
export function createFfmpegTool(command: string, timeoutMs = ENCODE_TIMEOUT_MS): FfmpegTool {
    return {
        command,
        run: async (args) => {
            await exec(command, args, timeoutMs, true);
        },
        capture: (args) => exec(command, args, timeoutMs),
        encoders: async () => (await exec(command, ["-hide_banner", "-encoders"], PROBE_TIMEOUT_MS)).toString("utf8"),
    };
}

import { spawnSync } from "node:child_process";

/** The process and timer calls the kill logic needs, injectable so tests need no real processes. */
export interface ProcessIo {
    /** `process.kill`. A negative pid signals a process group. */
    kill(pid: number, signal: NodeJS.Signals | 0): void;
    /** `child_process.spawnSync` without a shell; used for `taskkill` on Windows. */
    spawnSync(command: string, args: readonly string[]): SpawnResult;
    sleep(ms: number): Promise<void>;
    readonly platform: NodeJS.Platform;
}

/** The part of a `spawnSync` result the kill logic reads. `error` is set when the command could not be started at all. */
export interface SpawnResult {
    readonly status: number | null;
    readonly stderr: string;
    readonly error?: Error | undefined;
}

export interface TerminateOptions {
    /** Polls of `pollMs` after SIGTERM and after SIGKILL. Default 60 polls of 50 ms = 3 s each. */
    readonly polls?: number;
    readonly pollMs?: number;
}

const DEFAULT_POLLS = 60;
const DEFAULT_POLL_MS = 50;

/**
 * Group (`-pid`) on POSIX, where Playwright starts the Electron process as a group leader. Windows has no process
 * groups, so this is the single pid: a liveness probe only. Playwright starts Electron through `cmd.exe` there
 * (`shell: true`), which makes `pid` the shell's; `process.kill(pid)` would end `cmd.exe` and leave Obsidian running,
 * so the tree is ended with `taskkill /T` instead (see `killWindowsTree`).
 */
function targetFor(pid: number, platform: NodeJS.Platform): number {
    return platform === "win32" ? pid : -pid;
}

function errorCode(error: unknown): string | undefined {
    return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/** True while any process of the group is alive. EPERM means it exists but is not ours to signal: still alive. */
export function isTreeAlive(pid: number, io: ProcessIo): boolean {
    try {
        io.kill(targetFor(pid, io.platform), 0);
        return true;
    } catch (error) {
        const code = errorCode(error);
        if (code === "ESRCH") {
            return false;
        }
        if (code === "EPERM") {
            return true;
        }
        throw error;
    }
}

/** Sends a signal to the group and treats "already gone" (ESRCH) as success; any other error is real. */
function signalTree(pid: number, signal: NodeJS.Signals, io: ProcessIo): void {
    try {
        io.kill(targetFor(pid, io.platform), signal);
    } catch (error) {
        if (errorCode(error) !== "ESRCH") {
            throw error;
        }
    }
}

/** `taskkill` exit code for "no such process": the tree is already gone, which is what we wanted. */
const TASKKILL_NOT_FOUND = 128;

/** Ends the process and all of its descendants, as Playwright's own Windows teardown does. */
function killWindowsTree(pid: number, io: ProcessIo): void {
    const result = io.spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    if (result.error !== undefined) {
        throw new Error(
            `Could not run taskkill for Obsidian process ${String(pid)}: ${result.error.message}. Kill it by hand (taskkill /PID ${String(pid)} /T /F).`,
            { cause: result.error },
        );
    }
    if (result.status !== 0 && result.status !== TASKKILL_NOT_FOUND) {
        throw new Error(
            `taskkill /PID ${String(pid)} /T /F failed with exit code ${String(result.status)}: ${result.stderr.trim()}. Kill the process by hand.`,
        );
    }
}

async function waitUntilGone(pid: number, io: ProcessIo, polls: number, pollMs: number): Promise<boolean> {
    for (let i = 0; i < polls; i += 1) {
        if (!isTreeAlive(pid, io)) {
            return true;
        }
        await io.sleep(pollMs);
    }
    return !isTreeAlive(pid, io);
}

/**
 * Makes sure Obsidian's whole process tree is gone, and says what it took: `gone` (nothing left to kill),
 * `terminated` (SIGTERM was enough) or `killed` (SIGKILL, or `taskkill /T /F` on Windows). Throws when a process
 * survives.
 *
 * On POSIX it looks at the group, not at the main process: Chromium helpers (renderer, GPU, network) can outlive the
 * main process, and nothing may still be writing into the user-data folder when the caller deletes it.
 */
export async function terminateTree(
    pid: number,
    io: ProcessIo,
    options: TerminateOptions = {},
): Promise<"gone" | "terminated" | "killed"> {
    // `-0` and `-1` would signal the caller's own group or every process the user may signal, so refuse before any signal.
    if (!Number.isInteger(pid) || pid <= 1) {
        throw new Error(
            `Refusing to end Obsidian's process tree: ${String(pid)} is not a usable process id (expected an integer above 1). ` +
                `The Electron application did not report a pid; check the launch.`,
        );
    }
    const polls = options.polls ?? DEFAULT_POLLS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    if (!isTreeAlive(pid, io)) {
        return "gone";
    }
    if (io.platform === "win32") {
        killWindowsTree(pid, io);
        if (await waitUntilGone(pid, io, polls, pollMs)) {
            return "killed";
        }
        throw survivedError(pid, io);
    }
    signalTree(pid, "SIGTERM", io);
    if (await waitUntilGone(pid, io, polls, pollMs)) {
        return "terminated";
    }
    signalTree(pid, "SIGKILL", io);
    if (await waitUntilGone(pid, io, polls, pollMs)) {
        return "killed";
    }
    throw survivedError(pid, io);
}

function survivedError(pid: number, io: ProcessIo): Error {
    return new Error(
        `Obsidian process ${String(pid)} (and its helpers) survived ${io.platform === "win32" ? "taskkill" : "SIGKILL"}. ` +
            `Kill it by hand${io.platform === "win32" ? ` (taskkill /PID ${String(pid)} /T /F)` : ` (kill -9 -${String(pid)})`}.`,
    );
}

/** The real thing: `process.kill`, `spawnSync` and `setTimeout`. */
export function createProcessIo(): ProcessIo {
    return {
        kill: (pid, signal) => {
            process.kill(pid, signal);
        },
        spawnSync: (command, args) => {
            const result = spawnSync(command, [...args], { encoding: "utf8", windowsHide: true });
            return { status: result.status, stderr: result.stderr, error: result.error };
        },
        sleep: (ms) =>
            new Promise((resolve) => {
                setTimeout(resolve, ms);
            }),
        platform: process.platform,
    };
}

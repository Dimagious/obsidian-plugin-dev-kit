import { execFileSync } from "node:child_process";
import { listTempDirs } from "../../src/e2e/cleanup.js";

/** Every Obsidian the kit starts gets a `--user-data-dir` under a folder with this name. */
const USER_DATA_MARKER = "opdk-e2e-userdata-";
const SETTLE_MS = 5_000;
const POLL_MS = 250;

/** Processes whose command line mentions a kit user-data folder, as `pid command`. POSIX only: Windows has no `ps`. */
function listKitProcesses(): string[] | null {
    if (process.platform === "win32") {
        return null;
    }
    const out = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.includes(USER_DATA_MARKER));
}

function snapshot(before: { dirs: Set<string>; processes: Set<string> | null }): { dirs: string[]; processes: string[] } {
    const processes = listKitProcesses();
    return {
        dirs: listTempDirs().filter((name) => !before.dirs.has(name)),
        processes: processes === null || before.processes === null ? [] : processes.filter((line) => !before.processes?.has(line)),
    };
}

/**
 * Playwright global setup: remembers what is in the temp directory and what is running now, and returns the teardown
 * that fails the run when this run left a temp folder or a process (Chromium helpers get a few seconds to exit).
 */
export default function globalSetup(): () => Promise<void> {
    const processes = listKitProcesses();
    const before = { dirs: new Set(listTempDirs()), processes: processes === null ? null : new Set(processes) };
    return async () => {
        const deadline = Date.now() + SETTLE_MS;
        let left = snapshot(before);
        while ((left.dirs.length > 0 || left.processes.length > 0) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            left = snapshot(before);
        }
        const note = before.processes === null ? " (process check skipped: not available on Windows)" : "";
        console.log(`[e2e-smoke] left behind: ${String(left.dirs.length)} temp folder(s), ${String(left.processes.length)} process(es)${note}`);
        if (left.dirs.length > 0 || left.processes.length > 0) {
            throw new Error(
                `The e2e run left things behind.\n` +
                    `Temp folders: ${left.dirs.join(", ") || "none"}\n` +
                    `Processes:\n${left.processes.join("\n") || "none"}\n` +
                    `Remove the folders and kill the processes by hand, then report this.`,
            );
        }
    };
}

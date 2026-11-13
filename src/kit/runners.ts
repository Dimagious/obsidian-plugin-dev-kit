import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runs `npm <args>` in `cwd`. A failure carries the tail of npm's own output. */
export function createRunNpm(cwd: string, command = "npm"): (args: readonly string[]) => Promise<void> {
    return async (args) => {
        try {
            await execFileAsync(command, [...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                throw new Error(`${command} is not installed or not on PATH.`, { cause: error });
            }
            const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim().split("\n").slice(-8).join("\n") : "";
            throw new Error(`${command} ${args.join(" ")} failed: ${stderr === "" ? String(error) : stderr}`, { cause: error });
        }
    };
}

/** GET a URL as text, 20 seconds at most. */
export async function fetchText(url: string): Promise<string> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
        throw new Error(`${url} answered ${String(response.status)}`);
    }
    return response.text();
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** `npm install` builds the kit (`prepare`) after downloading it; a slow disk or network gets this long, no longer. */
export const NPM_TIMEOUT_MS = 10 * 60_000;

/** The most of a fetched file that is kept. The kit's CHANGELOG is a few tens of kilobytes. */
export const MAX_FETCH_BYTES = 1024 * 1024;

/** Runs `npm <args>` in `cwd`, ten minutes at most. A failure carries the tail of npm's own output. */
export function createRunNpm(cwd: string, command = "npm", timeoutMs = NPM_TIMEOUT_MS): (args: readonly string[]) => Promise<void> {
    return async (args) => {
        try {
            await execFileAsync(command, [...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, shell: process.platform === "win32" });
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                throw new Error(`${command} is not installed or not on PATH.`, { cause: error });
            }
            if (error instanceof Error && "killed" in error && error.killed === true) {
                throw new Error(`${command} ${args.join(" ")} did not finish in ${String(timeoutMs / 1000)} seconds and was stopped.`, { cause: error });
            }
            const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim().split("\n").slice(-8).join("\n") : "";
            throw new Error(`${command} ${args.join(" ")} failed: ${stderr === "" ? String(error) : stderr}`, { cause: error });
        }
    };
}

/**
 * GET a URL as text, 20 seconds at most. Reads no more than `maxBytes`; a longer body is cut and ends with a note
 * saying so.
 */
export async function fetchText(url: string, maxBytes = MAX_FETCH_BYTES): Promise<string> {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
        throw new Error(`${url} answered ${String(response.status)}`);
    }
    if (response.body === null) {
        return "";
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    let cut = false;
    for await (const chunk of response.body) {
        const room = maxBytes - size;
        if (chunk.byteLength > room) {
            chunks.push(chunk.subarray(0, room));
            cut = true;
            break;
        }
        chunks.push(chunk);
        size += chunk.byteLength;
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    return cut ? `${text}\n[opdk: ${url} is longer than ${String(maxBytes)} bytes; the rest was not read]\n` : text;
}

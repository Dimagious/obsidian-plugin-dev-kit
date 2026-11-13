/**
 * Vitest global setup: every test run gets its own temp root, so a leftover is attributable to exactly this run.
 *
 * The setup creates a fresh root under the OS temp directory and points the workers at it twice: `OPDK_TEST_TMP`
 * (read with `testTmpRoot()`) and `TMPDIR`/`TMP`/`TEMP`, so every folder a test or the code under test makes with
 * `os.tmpdir()` lands inside it. When the run ends it lists what is still inside, removes the root and fails the run
 * if anything was left. Two vitest runs on one machine therefore cannot fail each other, which a check on the shared
 * temp directory would.
 *
 * A run that is killed never reaches the teardown. The root records the pid of the process that made it, and the
 * next run removes roots whose process is gone. A root of a live run, or one without a pid file, is left alone.
 *
 * The failure is reported by vitest as "error during close", printed AFTER the "Tests N passed" summary, and the
 * process exits non-zero. A green summary line followed by that error is a failed run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TEST_TMP_ENV = "OPDK_TEST_TMP";

/** Prefix of a run's root in the OS temp directory. */
export const ROOT_PREFIX = "opdk-kit-tests-";

/** File in the root that holds the pid of the run that created it. */
export const OWNER_FILE = ".owner-pid";

/** The variables `os.tmpdir()` reads: `TMPDIR` on macOS and Linux, `TMP` and `TEMP` on Windows. */
const TEMP_VARS = ["TMPDIR", "TMP", "TEMP"] as const;

/** Whether a process with this pid exists. EPERM means it exists but belongs to another user. */
export function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

/**
 * Removes the roots in `base` that a killed run left: those whose pid file names a process that is gone. Returns
 * the names it removed. Roots without a readable pid file are kept: nothing says their run is over.
 */
export function removeStaleRoots(base: string, isAlive: (pid: number) => boolean = isProcessAlive): string[] {
    const removed: string[] = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(ROOT_PREFIX)) {
            continue;
        }
        const root = path.join(base, entry.name);
        let pid: number;
        try {
            pid = Number.parseInt(fs.readFileSync(path.join(root, OWNER_FILE), "utf8"), 10);
        } catch {
            continue;
        }
        if (!Number.isInteger(pid) || pid <= 0 || isAlive(pid)) {
            continue;
        }
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        removed.push(entry.name);
    }
    return removed.sort();
}

/**
 * Lists what is left in `root` besides its pid file, removes `root` (always, so a failing run does not litter the
 * temp directory itself) and throws naming every entry that was left.
 */
export function checkAndRemoveRoot(root: string): void {
    const left = fs
        .readdirSync(root)
        .filter((name) => name !== OWNER_FILE)
        .sort();
    const leftover =
        left.length > 0
            ? `The tests left ${String(left.length)} item(s) in the run's temp folder ${root}: ${left.join(", ")}. ` +
              `Every test that creates a temp file or folder must remove it, also when it fails.`
            : undefined;
    try {
        fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
        const removal = `Could not remove the test temp root ${root}: ${error instanceof Error ? error.message : String(error)}.`;
        throw new Error(leftover === undefined ? removal : `${leftover}\n${removal}`, { cause: error });
    }
    if (leftover !== undefined) {
        throw new Error(leftover);
    }
}

/**
 * Removes stale roots, creates the run's root under `base`, publishes it in `env` (`OPDK_TEST_TMP` and the temp
 * variables) and returns the teardown that puts the variables back and checks the root. `base`, `env`, `pid` and
 * `isAlive` are parameters so a test can run this against a temp directory of its own.
 */
export function startRun(
    base: string,
    env: Record<string, string | undefined>,
    pid: number = process.pid,
    isAlive: (pid: number) => boolean = isProcessAlive,
): () => void {
    removeStaleRoots(base, isAlive);
    const root = fs.mkdtempSync(path.join(base, ROOT_PREFIX));
    fs.writeFileSync(path.join(root, OWNER_FILE), String(pid));
    const saved = TEMP_VARS.map((name) => [name, env[name]] as const);
    env[TEST_TMP_ENV] = root;
    for (const name of TEMP_VARS) {
        env[name] = root;
    }
    return () => {
        for (const [name, value] of saved) {
            if (value === undefined) {
                Reflect.deleteProperty(env, name);
            } else {
                env[name] = value;
            }
        }
        checkAndRemoveRoot(root);
    };
}

export default function setup(): () => void {
    return startRun(os.tmpdir(), process.env);
}

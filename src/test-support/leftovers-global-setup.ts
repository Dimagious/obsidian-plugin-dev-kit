/**
 * Vitest global setup: every test run gets its own temp root, so a leftover is attributable to exactly this run.
 *
 * The e2e tests build vaults and user-data folders (`opdk-e2e-*`) and must remove every one. This setup creates a
 * fresh root under the OS temp directory, hands it to the workers in `OPDK_TEST_TMP` (read with `testTmpRoot()`), and
 * when the run ends it lists what is still inside, removes the root and fails the run if anything was left. Two
 * vitest runs on one machine therefore cannot fail each other, which a check on the shared `os.tmpdir()` would.
 *
 * The failure is reported by vitest as "error during close", printed AFTER the "Tests N passed" summary, and the
 * process exits non-zero. A green summary line followed by that error is a failed run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listTempDirs } from "../e2e/cleanup.js";

export const TEST_TMP_ENV = "OPDK_TEST_TMP";

/**
 * Lists the `opdk-e2e-*` folders left in `root`, removes `root` (always, so a failing run does not litter the temp
 * directory itself) and throws naming every folder that was left.
 */
export function checkAndRemoveRoot(root: string): void {
    const left = listTempDirs(root);
    const leftover =
        left.length > 0
            ? `The tests left ${String(left.length)} opdk-e2e-* folder(s) in ${root}: ${left.join(", ")}. ` +
              `Every test that creates one must remove it.`
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
 * Creates the run's root under `base`, publishes it in `env[OPDK_TEST_TMP]` and returns the teardown that checks it.
 * `base` and `env` are parameters so a test can run this against a temp directory of its own.
 */
export function startRun(base: string, env: Record<string, string | undefined>): () => void {
    const root = fs.mkdtempSync(path.join(base, "opdk-kit-tests-"));
    env[TEST_TMP_ENV] = root;
    return () => {
        checkAndRemoveRoot(root);
    };
}

export default function setup(): () => void {
    return startRun(os.tmpdir(), process.env);
}

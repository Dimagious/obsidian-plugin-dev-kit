import { TEST_TMP_ENV } from "./leftovers-global-setup.js";

/**
 * The temp root of this vitest run (created by the global setup). It is also `os.tmpdir()` in the workers, so every
 * temp file or folder of the run lands here and the global setup can tell this run's leftovers from anyone else's.
 */
export function testTmpRoot(env: Readonly<Record<string, string | undefined>> = process.env): string {
    const root = env[TEST_TMP_ENV];
    if (root === undefined || root === "") {
        throw new Error(
            `${TEST_TMP_ENV} is not set: the vitest global setup (src/test-support/leftovers-global-setup.ts) did not run. ` +
                `Run the tests through vitest with the repository's vitest.config.ts.`,
        );
    }
    return root;
}

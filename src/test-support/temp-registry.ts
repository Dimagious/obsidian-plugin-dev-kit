import { rmSync } from "node:fs";

/**
 * Temp folders the test helpers created and the test has not removed yet. A test that makes several fixtures and
 * keeps only the last one in a variable used to leak the others; the `afterEach` in `temp-registry-setup.ts`
 * removes whatever is still registered, so a fixture is gone after its test however the test ends.
 *
 * Per test only: a folder registered in `beforeAll` or at describe scope is removed after the first test. A fixture
 * shared by several tests is made with `mkdtempSync` under `testTmpRoot()` and removed in `afterAll`.
 */
const live = new Set<string>();

/** Registers a temp folder and returns the function that removes it (and unregisters it). */
export function registerTempDir(dir: string): () => void {
    live.add(dir);
    return () => {
        rmSync(dir, { recursive: true, force: true });
        live.delete(dir);
    };
}

/** Removes every registered folder. Returns how many there were. */
export function removeRegisteredTempDirs(): number {
    const dirs = [...live];
    for (const dir of dirs) {
        rmSync(dir, { recursive: true, force: true });
        live.delete(dir);
    }
    return dirs.length;
}

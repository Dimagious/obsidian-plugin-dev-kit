import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Every temp folder the harness creates starts with this, so a sweep and the kit's own tests can find leftovers. */
export const TEMP_PREFIX = "opdk-e2e-";

/**
 * Undo steps for a test session, run in reverse order. Every step runs even when an earlier one fails; the failures
 * are reported together, with each step's name, so a leftover folder is named in the error and never swallowed.
 */
export class CleanupStack {
    private readonly steps: { readonly name: string; readonly undo: () => void | Promise<void> }[] = [];

    add(name: string, undo: () => void | Promise<void>): void {
        this.steps.push({ name, undo });
    }

    /** Runs the steps once, newest first. Throws one error listing every step that failed. */
    async run(): Promise<void> {
        const failures: { name: string; error: unknown }[] = [];
        for (const step of this.steps.splice(0).reverse()) {
            try {
                await step.undo();
            } catch (error) {
                failures.push({ name: step.name, error });
            }
        }
        if (failures.length > 0) {
            const lines = failures.map(
                ({ name, error }) => `- ${name}: ${error instanceof Error ? error.message : String(error)}`,
            );
            throw new AggregateError(
                failures.map((failure) => failure.error),
                `Cleanup of the Obsidian e2e session failed:\n${lines.join("\n")}`,
            );
        }
    }
}

export interface RemoveDirOptions {
    /** Injectable so a test can force the failure. */
    readonly rm?: typeof fs.rmSync;
}

/**
 * Removes a temp folder, retrying, and throws when it is still there. Chromium helper processes can keep writing
 * into the folder for a moment after the main process exits, which makes a plain `rmSync` fail with ENOTEMPTY; node
 * retries ENOTEMPTY/EBUSY/EPERM with `maxRetries`/`retryDelay`. A folder that survives the retries fails the test
 * with its path: silently leaking temp folders is how a disk fills up over a week of e2e runs.
 */
export function removeDir(dir: string, options: RemoveDirOptions = {}): void {
    const rm = options.rm ?? fs.rmSync;
    try {
        rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
        throw new Error(
            `Could not remove ${dir} after retries: ${error instanceof Error ? error.message : String(error)}. ` +
                `Make sure no Obsidian process still uses it, then delete the folder by hand.`,
            { cause: error },
        );
    }
}

/** Creates a temp folder named `opdk-e2e-<kind>-<label>-XXXXXX`. `label` is cut to 40 characters of `[a-z0-9-]`. */
export function createTempDir(kind: string, label: string, root: string = os.tmpdir()): string {
    const safe = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    return fs.mkdtempSync(path.join(root, `${TEMP_PREFIX}${kind}-${safe === "" ? "" : `${safe}-`}`));
}

export interface SweepOptions {
    /** Default `os.tmpdir()`. */
    readonly root?: string;
    readonly olderThanHours: number;
    /** Default `Date.now()`. */
    readonly now?: number;
    readonly rm?: typeof fs.rmSync;
}

export interface SweepResult {
    readonly removed: readonly string[];
    readonly failed: readonly { readonly dir: string; readonly error: string }[];
}

/**
 * Removes `opdk-e2e-*` folders older than `olderThanHours` from `root`: what a crashed or killed run left behind.
 * Only real directories with the kit prefix are touched (symlinks are skipped). A folder that cannot be removed is
 * reported in `failed` instead of thrown: it belongs to an earlier run, not to the test that triggered the sweep.
 */
export function sweepLeftovers(options: SweepOptions): SweepResult {
    const root = options.root ?? os.tmpdir();
    const now = options.now ?? Date.now();
    const cutoff = now - options.olderThanHours * 3_600_000;
    const removed: string[] = [];
    const failed: { dir: string; error: string }[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) {
            continue;
        }
        const dir = path.join(root, entry.name);
        try {
            if (fs.statSync(dir).mtimeMs >= cutoff) {
                continue;
            }
            removeDir(dir, options.rm === undefined ? {} : { rm: options.rm });
            removed.push(dir);
        } catch (error) {
            failed.push({ dir, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { removed, failed };
}

/** Names of the kit's temp folders in `root`. The kit's own tests use it to assert that nothing is left. */
export function listTempDirs(root: string = os.tmpdir()): string[] {
    return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX))
        .map((entry) => entry.name)
        .sort();
}

/**
 * What a worker does before its first test: sweep old folders and say so. A folder that cannot be removed is a
 * warning (it belongs to an earlier run), not a failure of this one.
 */
export function sweepAtWorkerStart(
    olderThanHours: number | false,
    warn: (message: string) => void,
    root: string = os.tmpdir(),
): void {
    if (olderThanHours === false) {
        return;
    }
    const { removed, failed } = sweepLeftovers({ root, olderThanHours });
    if (removed.length > 0) {
        warn(`[e2e] removed ${String(removed.length)} leftover folder(s) from earlier runs.`);
    }
    for (const { dir, error } of failed) {
        warn(`[e2e] could not remove leftover ${dir}: ${error}`);
    }
}

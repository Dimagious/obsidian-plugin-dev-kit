/**
 * Pure helpers for the "which Obsidian did this run actually test?" check. No Node or Playwright imports on
 * purpose: the comparison is unit tested without touching Obsidian.
 */

const EXPLICIT_VERSION = /^\d+\.\d+\.\d+$/;

/** Outcome of comparing the version a run was meant to test with the one that is actually running. */
export interface VersionVerdict {
    /**
     * `match`: same x.y.z. `mismatch`: the run is testing the wrong build. `unknown`: one side could not be
     * determined, so nothing is claimed.
     */
    readonly status: "match" | "mismatch" | "unknown";
    /** Human-readable line for the failure message and the test annotation. */
    readonly message: string;
}

/** True for a plain `x.y.z` string. Channel aliases such as `latest` are not accepted: the kit only checks, it never downloads. */
export function isExplicitVersion(value: string): boolean {
    return EXPLICIT_VERSION.test(value);
}

/** Trims a version read from an env var or the renderer. Returns `null` when nothing usable is left. */
export function normalizeVersion(raw: string | null | undefined): string | null {
    const trimmed = raw?.trim();
    return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/**
 * Compares the expected and the running Obsidian version.
 *
 * Equality is on the trimmed string: Obsidian reports `x.y.z` for `ipcRenderer.sendSync("version")`, so no semver
 * range logic is wanted (a "close enough" match would defeat the check).
 */
export function compareObsidianVersions(
    expected: string | null | undefined,
    actual: string | null | undefined,
): VersionVerdict {
    const want = normalizeVersion(expected);
    const got = normalizeVersion(actual);
    if (got === null) {
        return { status: "unknown", message: "could not read the running Obsidian version from the renderer" };
    }
    if (want === null) {
        return { status: "unknown", message: `running Obsidian ${got}; no expected version to compare against` };
    }
    if (want === got) {
        return { status: "match", message: `Obsidian ${got}` };
    }
    return {
        status: "mismatch",
        message:
            `Obsidian version mismatch: expected ${want}, but ${got} is running. ` +
            `The run is not testing the build you asked for. Check OBSIDIAN_VERSION ` +
            `and the installed Obsidian (a newer obsidian-<version>.asar in the user-data ` +
            `dir, or an auto-update, can override the bundled one).`,
    };
}

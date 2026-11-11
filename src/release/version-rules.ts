import { errorProblem, warningProblem, type Problem } from "./problems.js";
import { asRecord } from "./json.js";
import { isPlainVersion } from "./semver.js";

const GROUP = "versions";

/** Where each version lives. `undefined` means the file or the entry is not there. */
export interface VersionSources {
    readonly manifest: unknown;
    readonly packageJson: unknown;
    /** The parsed package-lock.json, or undefined when the project has none. */
    readonly lock: unknown;
}

interface Entry {
    readonly label: string;
    readonly value: unknown;
}

/** The versions in manifest.json, package.json and package-lock.json (root `version` and `packages[""].version`). */
export function versionEntries({ manifest, packageJson, lock }: VersionSources): { entries: Entry[]; lockMissing: boolean } {
    const entries: Entry[] = [
        { label: "manifest.json", value: asRecord(manifest)?.version },
        { label: "package.json", value: asRecord(packageJson)?.version },
    ];
    const lockRecord = asRecord(lock);
    if (lockRecord !== undefined) {
        entries.push({ label: "package-lock.json version", value: lockRecord.version });
        const root = asRecord(asRecord(lockRecord.packages)?.[""]);
        if (root !== undefined) {
            entries.push({ label: 'package-lock.json packages[""].version', value: root.version });
        }
    }
    return { entries, lockMissing: lock === undefined };
}

/**
 * The version rules: every place holds an `x.y.z` version, all places agree, and the tag (when one is given)
 * is that version. The version in manifest.json is the reference, because that is what Obsidian reads.
 */
export function checkVersionSync(sources: VersionSources, tag?: string): Problem[] {
    const { entries, lockMissing } = versionEntries(sources);
    const problems: Problem[] = [];
    if (lockMissing) {
        problems.push(warningProblem(GROUP, "package-lock.json is missing, so its version was not checked.", "Commit package-lock.json: CI installs with `npm ci`."));
    }
    const reference = entries[0]?.value;
    for (const { label, value } of entries) {
        if (typeof value !== "string" || value === "") {
            problems.push(errorProblem(GROUP, `${label} has no version.`, 'Set "version": "x.y.z".'));
        } else if (!isPlainVersion(value)) {
            problems.push(
                errorProblem(
                    GROUP,
                    `${label} is "${value}", not an x.y.z version.`,
                    "Use three numbers and no prefix: Obsidian looks for a release tagged exactly like the manifest version, and pre-release versions are not supported yet.",
                ),
            );
        } else if (typeof reference === "string" && value !== reference) {
            problems.push(
                errorProblem(
                    GROUP,
                    `${label} is ${value} but manifest.json is ${reference}.`,
                    "Make the versions equal in manifest.json, package.json and package-lock.json (`opdk release <patch|minor|major>` sets all of them).",
                ),
            );
        }
    }
    if (tag !== undefined && typeof reference === "string" && tag !== reference) {
        if (tag === `v${reference}`) {
            problems.push(
                errorProblem(
                    GROUP,
                    `tag "${tag}" does not match manifest.json version ${reference}: Obsidian release tags have no "v" prefix.`,
                    `Obsidian looks for a release tagged exactly like the manifest version, so the tag must be ${reference}.`,
                ),
            );
        } else {
            problems.push(errorProblem(GROUP, `tag "${tag}" does not match manifest.json version ${reference}.`, `Tag the commit ${reference}, or fix the version in manifest.json.`));
        }
    }
    return problems;
}

/**
 * The tag a check compares with: `--tag` first, else `GITHUB_REF_NAME` when `GITHUB_REF_TYPE` says the run is for a
 * tag (a branch run must not be compared with its branch name).
 */
export function resolveTag(flag: string | undefined, env: Readonly<Record<string, string | undefined>>): string | undefined {
    if (flag !== undefined) {
        return flag;
    }
    const name = env.GITHUB_REF_NAME;
    return env.GITHUB_REF_TYPE === "tag" && name !== undefined && name !== "" ? name : undefined;
}

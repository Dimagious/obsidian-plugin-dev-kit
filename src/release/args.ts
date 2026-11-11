import type { CheckFlags } from "./check.js";
import { ALL_CHECKS } from "./check.js";
import { bumpVersion, isBumpKind, isPlainVersion, type BumpKind } from "./semver.js";

/** What the user asked the new version to be: a bump of the current one, or an exact version. */
export type VersionSpec = { readonly kind: "bump"; readonly bump: BumpKind } | { readonly kind: "exact"; readonly version: string };

export type ReleaseArgs =
    | { readonly mode: "check"; readonly tag: string | undefined; readonly flags: CheckFlags }
    | { readonly mode: "bump"; readonly spec: VersionSpec; readonly dryRun: boolean; readonly flags: CheckFlags };

const SKIP_FLAGS: Readonly<Record<string, Partial<CheckFlags>>> = {
    "--no-build": { build: false },
    "--no-reproducible": { reproducible: false },
    "--no-api": { api: false },
};

const USAGE_HINT = 'Run "opdk release --help".';

/** Parses what follows `opdk release`. Throws a message that says what to type instead. */
export function parseReleaseArgs(args: readonly string[]): ReleaseArgs {
    const [first, ...rest] = args;
    if (first === undefined) {
        throw new Error(`"opdk release" needs "check", patch, minor, major or a version such as 1.4.0. ${USAGE_HINT}`);
    }
    let flags: CheckFlags = ALL_CHECKS;
    let tag: string | undefined;
    let dryRun = false;
    for (let index = 0; index < rest.length; index++) {
        const arg = rest[index] ?? "";
        const skip = SKIP_FLAGS[arg];
        if (skip !== undefined) {
            flags = { ...flags, ...skip };
        } else if (arg === "--dry-run") {
            dryRun = true;
        } else if (arg === "--tag" || arg.startsWith("--tag=")) {
            const value = arg === "--tag" ? rest[++index] : arg.slice("--tag=".length);
            if (value === undefined || value === "" || value.startsWith("--")) {
                throw new Error(`"--tag" needs the tag name, for example --tag 1.2.3. ${USAGE_HINT}`);
            }
            tag = value;
        } else {
            throw new Error(`Unknown argument "${arg}" for "opdk release ${first}". ${USAGE_HINT}`);
        }
    }
    if (first === "check") {
        if (dryRun) {
            throw new Error(`"--dry-run" belongs to "opdk release <version>", not to "check". ${USAGE_HINT}`);
        }
        return { mode: "check", tag, flags };
    }
    if (tag !== undefined) {
        throw new Error(`"--tag" belongs to "opdk release check": a release creates the tag itself. ${USAGE_HINT}`);
    }
    return { mode: "bump", spec: parseSpec(first), dryRun, flags };
}

function parseSpec(value: string): VersionSpec {
    if (isBumpKind(value)) {
        return { kind: "bump", bump: value };
    }
    if (isPlainVersion(value)) {
        return { kind: "exact", version: value };
    }
    const hint = /^v\d+\.\d+\.\d+$/.test(value)
        ? ` Obsidian needs the tag to be exactly the manifest version, so write ${value.slice(1)} without the "v".`
        : " Pre-release versions are not supported yet.";
    throw new Error(`"${value}" is not patch, minor, major or an x.y.z version.${hint}`);
}

/** The version a spec leads to from `current`. */
export function resolveVersion(spec: VersionSpec, current: string): string {
    return spec.kind === "exact" ? spec.version : bumpVersion(current, spec.bump);
}

import type { CheckFlags } from "./check.js";
import { ALL_CHECKS } from "./check.js";
import { bumpVersion, isBumpKind, isPlainVersion, type BumpKind } from "./semver.js";

/** What the user asked the new version to be: a bump of the current one, or an exact version. */
export type VersionSpec = { readonly kind: "bump"; readonly bump: BumpKind } | { readonly kind: "exact"; readonly version: string };

/** Options of the push flow: whether to run it, how long to wait for the workflow, whether the release carries a zip. */
export interface PushOptions {
    readonly push: boolean;
    /** Undefined: the default. */
    readonly timeoutMinutes: number | undefined;
    readonly zip: boolean;
}

export type ReleaseArgs =
    | { readonly mode: "check"; readonly tag: string | undefined; readonly flags: CheckFlags }
    | { readonly mode: "bump"; readonly spec: VersionSpec; readonly dryRun: boolean; readonly flags: CheckFlags; readonly pushing: PushOptions; readonly test: boolean }
    | { readonly mode: "publish"; readonly version: string | undefined; readonly pushing: PushOptions }
    | { readonly mode: "notes"; readonly version: string | undefined };

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
    let push = true;
    let zip = false;
    let test = true;
    let timeoutMinutes: number | undefined;
    let positional: string | undefined;
    const used: string[] = [];
    for (let index = 0; index < rest.length; index++) {
        const arg = rest[index] ?? "";
        const skip = SKIP_FLAGS[arg];
        if (skip !== undefined) {
            flags = { ...flags, ...skip };
            used.push(arg);
        } else if (arg === "--dry-run") {
            dryRun = true;
            used.push(arg);
        } else if (arg === "--no-push") {
            push = false;
            used.push(arg);
        } else if (arg === "--no-test") {
            test = false;
            used.push(arg);
        } else if (arg === "--zip") {
            zip = true;
            used.push(arg);
        } else if (arg === "--timeout" || arg.startsWith("--timeout=")) {
            const value = arg === "--timeout" ? rest[++index] : arg.slice("--timeout=".length);
            timeoutMinutes = Number(value);
            if (value === undefined || !/^\d+$/.test(value) || timeoutMinutes < 1) {
                throw new Error(`"--timeout" needs a whole number of minutes, for example --timeout 30. ${USAGE_HINT}`);
            }
            used.push("--timeout");
        } else if (arg === "--tag" || arg.startsWith("--tag=")) {
            const value = arg === "--tag" ? rest[++index] : arg.slice("--tag=".length);
            if (value === undefined || value === "" || value.startsWith("--")) {
                throw new Error(`"--tag" needs the tag name, for example --tag 1.2.3. ${USAGE_HINT}`);
            }
            tag = value;
            used.push("--tag");
        } else if ((first === "publish" || first === "notes") && !arg.startsWith("-") && positional === undefined) {
            positional = arg;
        } else {
            throw new Error(`Unknown argument "${arg}" for "opdk release ${first}". ${USAGE_HINT}`);
        }
    }
    const reject = (allowed: readonly string[], what: string): void => {
        const wrong = used.find((flag) => !allowed.includes(flag));
        if (wrong !== undefined) {
            throw new Error(`"${wrong}" does not belong to "${what}". ${USAGE_HINT}`);
        }
    };
    if (first === "check") {
        if (dryRun) {
            throw new Error(`"--dry-run" belongs to "opdk release <version>", not to "check". ${USAGE_HINT}`);
        }
        reject(["--tag", ...Object.keys(SKIP_FLAGS)], "opdk release check");
        return { mode: "check", tag, flags };
    }
    if (first === "notes") {
        reject([], "opdk release notes");
        return { mode: "notes", version: parseOptionalVersion(positional) };
    }
    if (first === "publish") {
        reject(["--timeout", "--zip"], "opdk release publish");
        return { mode: "publish", version: parseOptionalVersion(positional), pushing: { push: true, timeoutMinutes, zip } };
    }
    if (tag !== undefined) {
        throw new Error(`"--tag" belongs to "opdk release check": a release creates the tag itself. ${USAGE_HINT}`);
    }
    if (!push && (zip || timeoutMinutes !== undefined)) {
        throw new Error(`"--zip" and "--timeout" describe the push flow, which "--no-push" turns off. ${USAGE_HINT}`);
    }
    return { mode: "bump", spec: parseSpec(first), dryRun, flags, pushing: { push, timeoutMinutes, zip }, test };
}

function parseOptionalVersion(value: string | undefined): string | undefined {
    if (value !== undefined && !isPlainVersion(value)) {
        throw new Error(`"${value}" is not an x.y.z version. Write it without a "v", for example 1.4.0. ${USAGE_HINT}`);
    }
    return value;
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

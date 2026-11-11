/** A plugin version as Obsidian needs it: three numbers. Pre-releases are not supported yet. */
const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

/** The official action's semver regex (`src/manifest.ts` of obsidianmd/obsidian-workflows): a pre-release suffix is accepted. */
const LOOSE_SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/;

export function isPlainVersion(value: string): boolean {
    return PLAIN_VERSION.test(value);
}

export function isSemver(value: string): boolean {
    return LOOSE_SEMVER.test(value);
}

interface Parsed {
    readonly core: readonly [number, number, number];
    readonly pre: string | undefined;
}

function parse(value: string): Parsed | undefined {
    const match = LOOSE_SEMVER.exec(value);
    if (match === null) {
        return undefined;
    }
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] };
}

/** Negative when `a` is lower than `b`; undefined when either is not a semver. A pre-release is lower than its release. */
export function compareVersions(a: string, b: string): number | undefined {
    const left = parse(a);
    const right = parse(b);
    if (left === undefined || right === undefined) {
        return undefined;
    }
    for (let index = 0; index < 3; index++) {
        const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    if (left.pre === right.pre) {
        return 0;
    }
    if (left.pre === undefined) {
        return 1;
    }
    if (right.pre === undefined) {
        return -1;
    }
    return left.pre < right.pre ? -1 : 1;
}

export type BumpKind = "patch" | "minor" | "major";

export function isBumpKind(value: string): value is BumpKind {
    return value === "patch" || value === "minor" || value === "major";
}

/** `1.2.3` becomes `1.2.4`, `1.3.0` or `2.0.0`. */
export function bumpVersion(current: string, kind: BumpKind): string {
    const parsed = PLAIN_VERSION.test(current) ? parse(current) : undefined;
    if (parsed === undefined) {
        throw new Error(`Cannot bump "${current}": it is not an x.y.z version.`);
    }
    const [major, minor, patch] = parsed.core;
    switch (kind) {
        case "major":
            return `${String(major + 1)}.0.0`;
        case "minor":
            return `${String(major)}.${String(minor + 1)}.0`;
        case "patch":
            return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
    }
}

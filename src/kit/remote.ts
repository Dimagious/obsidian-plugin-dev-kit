import { compareVersions, isPlainVersion } from "../release/semver.js";
import { stripV } from "./pins.js";

/** Tag name to the commit it points at. */
export type KitTags = ReadonlyMap<string, string>;

/**
 * Reads `git ls-remote --tags` output. An annotated tag is listed twice: the tag object, then `<tag>^{}` with the
 * commit it points at; the commit wins. Only `vX.Y.Z` tags are kept (the kit's release tags).
 */
export function parseKitTags(output: string): KitTags {
    const direct = new Map<string, string>();
    const peeled = new Map<string, string>();
    for (const line of output.split("\n")) {
        const match = /^([0-9a-f]{40})\s+refs\/tags\/(v\d+\.\d+\.\d+)(\^\{\})?$/.exec(line.trim());
        const sha = match?.[1];
        const name = match?.[2];
        if (sha !== undefined && name !== undefined) {
            (match?.[3] === undefined ? direct : peeled).set(name, sha);
        }
    }
    return new Map([...direct].map(([name, sha]) => [name, peeled.get(name) ?? sha]));
}

/** Release tags, highest first. */
export function sortedTags(tags: KitTags): string[] {
    return [...tags.keys()].filter((name) => isPlainVersion(stripV(name))).sort((a, b) => compareVersions(stripV(b), stripV(a)) ?? 0);
}

/** The highest `vX.Y.Z` tag, or undefined when there is none. */
export function latestTag(tags: KitTags): string | undefined {
    return sortedTags(tags)[0];
}

export function kitRepositoryUrl(owner: string): string {
    return `https://github.com/${owner}/obsidian-plugin-dev-kit.git`;
}

export function kitChangelogUrl(owner: string, tag: string): string {
    return `https://raw.githubusercontent.com/${owner}/obsidian-plugin-dev-kit/${tag}/CHANGELOG.md`;
}

import { asRecord } from "./json.js";

/** A release as the REST API returns it, reduced to what the verification reads. */
export interface ReleaseInfo {
    readonly id: number;
    readonly tag: string;
    readonly draft: boolean;
    readonly prerelease: boolean;
    readonly url: string;
    readonly assets: readonly ReleaseAsset[];
}

export interface ReleaseAsset {
    readonly id: number;
    readonly name: string;
    readonly size: number;
    /** `uploaded` once the upload finished. */
    readonly state: string;
}

function parseAsset(value: unknown): ReleaseAsset | undefined {
    const record = asRecord(value);
    if (record === undefined || typeof record.id !== "number" || typeof record.name !== "string") {
        return undefined;
    }
    return { id: record.id, name: record.name, size: typeof record.size === "number" ? record.size : 0, state: typeof record.state === "string" ? record.state : "" };
}

export function parseRelease(value: unknown): ReleaseInfo | undefined {
    const record = asRecord(value);
    if (record === undefined || typeof record.id !== "number" || typeof record.tag_name !== "string") {
        return undefined;
    }
    const assets = Array.isArray(record.assets) ? record.assets.flatMap((asset: unknown) => parseAsset(asset) ?? []) : [];
    return {
        id: record.id,
        tag: record.tag_name,
        draft: record.draft === true,
        prerelease: record.prerelease === true,
        url: typeof record.html_url === "string" ? record.html_url : "",
        assets,
    };
}

/** The releases for a tag in one page of `GET /releases` (drafts are listed there, and not by `/releases/tags/<tag>`), and how many entries the page had. */
export function releasesOfTag(json: string, tag: string): { readonly found: ReleaseInfo[]; readonly count: number } {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) {
        throw new Error("GitHub did not return a list of releases.");
    }
    const found: ReleaseInfo[] = [];
    for (const entry of parsed) {
        const release = parseRelease(entry);
        if (release?.tag === tag) {
            found.push(release);
        }
    }
    return { found, count: parsed.length };
}

export interface ExpectedAssets {
    /** `main.js`, `manifest.json`, `styles.css` when the plugin has CSS, and the zip when asked for. */
    readonly names: readonly string[];
    /** The subset that carries an attestation (everything but the zip). */
    readonly attested: readonly string[];
}

/** What the release must hold: the three Obsidian files, `styles.css` only if the plugin has one. */
export function expectedAssets(options: { readonly hasCss: boolean; readonly zipName: string | undefined }): ExpectedAssets {
    const attested = ["main.js", "manifest.json", ...(options.hasCss ? ["styles.css"] : [])];
    return { names: [...attested, ...(options.zipName === undefined ? [] : [options.zipName])], attested };
}

/** What is wrong with the asset list of a release: missing, unexpected, unfinished or empty files. */
export function assetProblems(release: ReleaseInfo, expected: ExpectedAssets): string[] {
    const problems: string[] = [];
    const present = new Set(release.assets.map((asset) => asset.name));
    for (const name of expected.names) {
        if (!present.has(name)) {
            problems.push(`the release has no asset ${name}.`);
        }
    }
    for (const asset of release.assets) {
        if (!expected.names.includes(asset.name)) {
            problems.push(`the release has an unexpected asset ${asset.name}. Obsidian reads main.js, manifest.json and styles.css only.`);
        } else if (asset.state !== "uploaded") {
            problems.push(`the asset ${asset.name} is in the state "${asset.state}", not "uploaded".`);
        } else if (asset.size === 0) {
            problems.push(`the asset ${asset.name} is empty.`);
        }
    }
    return problems;
}

/** The name of the optional zip asset: the plugin id and the version, as the kit's workflow names it. */
export const zipAssetName = (id: string, version: string): string => `${id}-${version}.zip`;

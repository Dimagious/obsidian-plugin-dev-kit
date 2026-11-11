import { promoteUnreleased } from "./changelog.js";
import { asRecord, stringifyLike, type Loaded } from "./json.js";
import type { ProjectFiles } from "./project-files.js";

/** A file the bump rewrites: its path relative to the plugin root, and its text before and after. */
export interface PlannedFile {
    readonly path: string;
    /** Undefined when the file does not exist yet (versions.json in a plugin that has none). */
    readonly before: string | undefined;
    readonly after: string;
}

export interface BumpPlanInput {
    readonly files: ProjectFiles;
    readonly changelogFile: string;
    /** The version to release. */
    readonly version: string;
    /** `YYYY-MM-DD`, for the changelog heading. */
    readonly date: string;
}

function okJson(loaded: Loaded, name: string): { text: string; value: Record<string, unknown> } {
    const value = loaded.kind === "ok" ? asRecord(loaded.value) : undefined;
    if (loaded.kind !== "ok" || value === undefined) {
        throw new Error(`${name} cannot be read as a JSON object.`);
    }
    return { text: loaded.text, value };
}

/**
 * The new text of every file a release changes: `package.json`, `package-lock.json` (both version fields),
 * `manifest.json`, `versions.json` (the new version is added; an existing entry is never rewritten) and the
 * changelog. Pure: nothing is written here. Throws when a file is not in a shape it can edit.
 */
export function planBump({ files, changelogFile, version, date }: BumpPlanInput): PlannedFile[] {
    const planned: PlannedFile[] = [];
    const pkg = okJson(files.packageJson, "package.json");
    planned.push({ path: "package.json", before: pkg.text, after: stringifyLike(pkg.text, pkg.value, { ...pkg.value, version }, "package.json") });

    if (files.lock.kind === "ok") {
        const lock = okJson(files.lock, "package-lock.json");
        const packages = asRecord(lock.value.packages);
        const root = asRecord(packages?.[""]);
        const changed = {
            ...lock.value,
            version,
            ...(packages !== undefined && root !== undefined && { packages: { ...packages, "": { ...root, version } } }),
        };
        planned.push({ path: "package-lock.json", before: lock.text, after: stringifyLike(lock.text, lock.value, changed, "package-lock.json") });
    }

    const manifest = okJson(files.manifest, "manifest.json");
    const minAppVersion = manifest.value.minAppVersion;
    if (typeof minAppVersion !== "string") {
        throw new Error("manifest.json has no minAppVersion to map the new version to.");
    }
    planned.push({ path: "manifest.json", before: manifest.text, after: stringifyLike(manifest.text, manifest.value, { ...manifest.value, version }, "manifest.json") });

    if (files.versions.kind === "ok") {
        const versions = okJson(files.versions, "versions.json");
        if (!Object.hasOwn(versions.value, version)) {
            planned.push({ path: "versions.json", before: versions.text, after: stringifyLike(versions.text, versions.value, { ...versions.value, [version]: minAppVersion }, "versions.json") });
        }
    } else if (files.versions.kind === "missing") {
        planned.push({ path: "versions.json", before: undefined, after: `${JSON.stringify({ [version]: minAppVersion }, null, 2)}\n` });
    } else {
        throw new Error(`versions.json is not valid JSON: ${files.versions.message}.`);
    }

    if (files.changelog === undefined) {
        throw new Error(`${changelogFile} does not exist.`);
    }
    planned.push({ path: changelogFile, before: files.changelog, after: promoteUnreleased(files.changelog, version, date) });
    return planned;
}

/** `2026-11-11` for the local date of `now`. */
export function formatDate(now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

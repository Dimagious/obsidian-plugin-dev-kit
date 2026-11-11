import { describe, expect, it } from "vitest";
import { CHANGELOG, VALID_MANIFEST } from "../test-support/release-fixture.js";
import { formatDate, planBump } from "./bump.js";
import type { Loaded } from "./json.js";
import type { ProjectFiles } from "./project-files.js";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const ok = (value: unknown): Loaded => ({ kind: "ok", text: json(value), value });

const files = (changes: Partial<ProjectFiles> = {}): ProjectFiles => ({
    packageJson: ok({ name: "p", version: "1.0.0", private: true }),
    lock: ok({ name: "p", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "p", version: "1.0.0" }, "node_modules/x": { version: "1.0.0" } } }),
    manifest: ok(VALID_MANIFEST),
    versions: ok({ "1.0.0": "1.5.0" }),
    changelog: CHANGELOG,
    ...changes,
});
const plan = (changes: Partial<ProjectFiles> = {}): Map<string, string> =>
    new Map(planBump({ files: files(changes), changelogFile: "CHANGELOG.md", version: "1.1.0", date: "2026-11-11" }).map((file) => [file.path, file.after]));

describe("planBump", () => {
    it("changes the version in package.json and manifest.json and nothing else in them", () => {
        const result = plan();
        expect(result.get("package.json")).toBe(json({ name: "p", version: "1.1.0", private: true }));
        expect(result.get("manifest.json")).toBe(json({ ...VALID_MANIFEST, version: "1.1.0" }));
    });

    it("changes both version fields of the lockfile, not a dependency's", () => {
        const lock = JSON.parse(plan().get("package-lock.json") ?? "{}") as { version: string; packages: Record<string, { version: string }> };
        expect(lock.version).toBe("1.1.0");
        expect(lock.packages[""]?.version).toBe("1.1.0");
        expect(lock.packages["node_modules/x"]?.version).toBe("1.0.0");
    });

    it("leaves a lockfile v1 without packages with just the root version", () => {
        const lock = ok({ name: "p", version: "1.0.0", lockfileVersion: 1 });
        expect(JSON.parse(plan({ lock }).get("package-lock.json") ?? "{}")).toEqual({ name: "p", version: "1.1.0", lockfileVersion: 1 });
    });

    it("skips a project without a lockfile", () => {
        expect(plan({ lock: { kind: "missing" } }).has("package-lock.json")).toBe(false);
    });

    it("adds the new version to versions.json with the manifest's minAppVersion, keeping the old entries", () => {
        expect(plan().get("versions.json")).toBe(json({ "1.0.0": "1.5.0", "1.1.0": "1.5.0" }));
    });

    it("never rewrites an existing entry", () => {
        expect(plan({ versions: ok({ "1.0.0": "1.5.0", "1.1.0": "1.5.0" }) }).has("versions.json")).toBe(false);
    });

    it("creates versions.json for a plugin that has none", () => {
        const planned = planBump({ files: files({ versions: { kind: "missing" } }), changelogFile: "CHANGELOG.md", version: "1.1.0", date: "2026-11-11" }).find((file) => file.path === "versions.json");
        expect(planned).toEqual({ path: "versions.json", before: undefined, after: json({ "1.1.0": "1.5.0" }) });
    });

    it("moves the changelog entries under the version and date", () => {
        expect(plan().get("CHANGELOG.md")).toContain("## [1.1.0] - 2026-11-11");
    });

    it("throws, saying which file, when one cannot be edited", () => {
        expect(() => plan({ packageJson: { kind: "missing" } })).toThrow("package.json cannot be read as a JSON object.");
        expect(() => plan({ versions: { kind: "invalid", message: "boom" } })).toThrow("versions.json is not valid JSON: boom.");
        expect(() => plan({ changelog: undefined })).toThrow("CHANGELOG.md does not exist.");
        expect(() => plan({ manifest: ok({ ...VALID_MANIFEST, minAppVersion: undefined }) })).toThrow("no minAppVersion");
    });
});

describe("formatDate", () => {
    it("writes the local date as YYYY-MM-DD with zero padding", () => {
        expect(formatDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
        expect(formatDate(new Date(2026, 10, 11, 0, 0))).toBe("2026-11-11");
    });
});

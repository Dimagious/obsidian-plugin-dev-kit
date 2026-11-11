import { describe, expect, it } from "vitest";
import { assetProblems, expectedAssets, parseRelease, releasesOfTag, zipAssetName, type ReleaseInfo } from "./release-assets.js";

const asset = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 1, name, size: 10, state: "uploaded", ...extra });
const release = (assets: Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 9, tag_name: "1.2.3", draft: true, prerelease: false, html_url: "https://example.com/r", assets, ...extra });

describe("releasesOfTag", () => {
    it("finds a draft by tag among several releases and counts the page", () => {
        const json = JSON.stringify([release([], { tag_name: "1.2.4", id: 10 }), release([asset("main.js")])]);
        expect(releasesOfTag(json, "1.2.3")).toEqual({ count: 2, found: [{ id: 9, tag: "1.2.3", draft: true, prerelease: false, url: "https://example.com/r", assets: [{ id: 1, name: "main.js", size: 10, state: "uploaded" }] }] });
    });

    it("returns every release of the tag, so a duplicate is visible", () => {
        const json = JSON.stringify([release([], { id: 1 }), release([], { id: 2, draft: false })]);
        expect(releasesOfTag(json, "1.2.3").found.map((entry) => entry.id)).toEqual([1, 2]);
    });

    it("returns nothing when the tag has no release, and skips malformed entries", () => {
        expect(releasesOfTag(JSON.stringify([release([], { tag_name: "1.0.0" }), "junk", null]), "1.2.3")).toEqual({ found: [], count: 3 });
        expect(releasesOfTag("[]", "1.2.3")).toEqual({ found: [], count: 0 });
    });

    it("rejects a payload that is not a list", () => {
        expect(() => releasesOfTag("{}", "1.2.3")).toThrow("did not return a list of releases");
    });
});

describe("parseRelease", () => {
    it("defaults what is missing", () => {
        expect(parseRelease({ id: 1, tag_name: "1.0.0" })).toEqual({ id: 1, tag: "1.0.0", draft: false, prerelease: false, url: "", assets: [] });
        expect(parseRelease({ id: "x" })).toBeUndefined();
        expect(parseRelease({ id: 1, tag_name: "1", assets: [{ name: "a" }, { id: 2, name: "b" }] })?.assets).toEqual([{ id: 2, name: "b", size: 0, state: "" }]);
    });
});

describe("expectedAssets", () => {
    it("lists styles.css only for a plugin with CSS, and the zip only when asked", () => {
        expect(expectedAssets({ hasCss: false, zipName: undefined })).toEqual({ names: ["main.js", "manifest.json"], attested: ["main.js", "manifest.json"] });
        expect(expectedAssets({ hasCss: true, zipName: "p-1.0.0.zip" })).toEqual({ names: ["main.js", "manifest.json", "styles.css", "p-1.0.0.zip"], attested: ["main.js", "manifest.json", "styles.css"] });
        expect(zipAssetName("p", "1.0.0")).toBe("p-1.0.0.zip");
    });
});

describe("assetProblems", () => {
    const parsed = (assets: Record<string, unknown>[]): ReleaseInfo => {
        const info = parseRelease(release(assets));
        if (info === undefined) {
            throw new Error("fixture");
        }
        return info;
    };
    const expected = expectedAssets({ hasCss: true, zipName: undefined });

    it("passes with exactly the expected assets", () => {
        expect(assetProblems(parsed([asset("main.js"), asset("manifest.json"), asset("styles.css")]), expected)).toEqual([]);
    });

    it("names a missing, an unexpected, an unfinished and an empty asset", () => {
        const problems = assetProblems(parsed([asset("main.js", { size: 0 }), asset("manifest.json", { state: "open" }), asset("notes.txt")]), expected);
        expect(problems).toEqual([
            "the release has no asset styles.css.",
            "the asset main.js is empty.",
            'the asset manifest.json is in the state "open", not "uploaded".',
            "the release has an unexpected asset notes.txt. Obsidian reads main.js, manifest.json and styles.css only.",
        ]);
    });
});

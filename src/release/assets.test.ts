import { describe, expect, it } from "vitest";
import { checkAssets, type AssetInput } from "./assets.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const BASE: AssetInput = {
    mainJs: bytes("code"),
    builtCss: bytes("css"),
    rootCss: undefined,
    manifestText: '{"id":"a"}',
    outputManifestText: undefined,
    outfile: "main.js",
};
const run = (changes: Partial<AssetInput>): string[] => checkAssets({ ...BASE, ...changes }).map((problem) => `${problem.severity}: ${problem.message}`);

describe("checkAssets", () => {
    it("passes with main.js and a built stylesheet", () => {
        expect(run({})).toEqual([]);
    });

    it("fails when main.js is missing or empty", () => {
        expect(run({ mainJs: undefined })).toEqual(["error: the build did not write main.js."]);
        expect(run({ mainJs: bytes("") })).toEqual(["error: main.js is empty."]);
    });

    it("accepts a hand-written styles.css at the root when there is no CSS entry", () => {
        expect(run({ builtCss: undefined, rootCss: bytes("css") })).toEqual([]);
    });

    it("warns about a plugin that ships no stylesheet, and fails on an empty one", () => {
        expect(run({ builtCss: undefined })[0]).toContain("warning: the plugin ships no styles.css");
        expect(run({ builtCss: bytes("") })).toEqual(["error: styles.css is empty."]);
    });

    it("compares the manifest next to a bundle built outside the root, ignoring formatting", () => {
        expect(run({ outputManifestText: '{ "id": "a" }' })).toEqual([]);
        expect(run({ outputManifestText: '{"id":"b"}' })).toEqual(["error: the manifest.json next to main.js differs from the one at the plugin root."]);
        expect(run({ outputManifestText: "not json" })).toHaveLength(1);
    });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PUBLISHING, parseStillPublishing, readStillPublishing, resolveStillPublishing, serializeStillPublishing, writeStillPublishing } from "./still-options.js";

describe("resolveStillPublishing", () => {
    it("publishes to the default folder when nothing is asked", () => {
        expect(resolveStillPublishing({}, "still")).toEqual({ publish: true });
        expect(resolveStillPublishing({ publish: true }, "still")).toEqual({ publish: true });
    });

    it("takes publish: false and a named folder", () => {
        expect(resolveStillPublishing({ publish: false }, "still")).toEqual({ publish: false });
        expect(resolveStillPublishing({ out: "listing" }, "still")).toEqual({ publish: true, out: "listing" });
        expect(resolveStillPublishing({ publish: true, out: "listing" }, "still")).toEqual({ publish: true, out: "listing" });
    });

    it("refuses a non-boolean publish, a non-string out, an unsafe out and the contradiction", () => {
        expect(() => resolveStillPublishing({ publish: 1 }, "still")).toThrow("still: publish must be true");
        expect(() => resolveStillPublishing({ out: 1 }, "still")).toThrow("still: out must be the name of a folder in demo.outputs");
        expect(() => resolveStillPublishing({ out: "../x" }, "still")).toThrow(/out name "\.\.\/x" is not usable/);
        expect(() => resolveStillPublishing({ out: "" }, "still")).toThrow(/is not usable/);
        expect(() => resolveStillPublishing({ publish: false, out: "listing" }, "still")).toThrow("out has no effect with publish: false");
    });
});

describe("parseStillPublishing", () => {
    it("round-trips what the fixture writes", () => {
        for (const value of [{ publish: true }, { publish: false }, { publish: true, out: "listing" }]) {
            expect(parseStillPublishing(serializeStillPublishing(value), "f.json")).toEqual(value);
        }
    });

    it.each(["{ nope", "[]", "null", '{"publish":"yes"}', '{"out":"x"}', '{"publish":true,"out":3}'])("names the file and says to record again for %s", (text) => {
        expect(() => parseStillPublishing(text, "x/f.json")).toThrow(/x\/f\.json .*Record the still again\./);
    });
});

describe("files", () => {
    let outDir: string;
    beforeEach(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-still-options-"));
    });
    afterEach(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    it("reads back what was written", () => {
        writeStillPublishing(outDir, "hero", { publish: true, out: "listing" });
        expect(readStillPublishing(outDir, "hero")).toEqual({ publish: true, out: "listing" });
    });

    it("gives the default for a still from an earlier kit version (no file)", () => {
        expect(readStillPublishing(outDir, "old")).toEqual(DEFAULT_PUBLISHING);
    });

    it("fails on a file it cannot read as a file", () => {
        fs.mkdirSync(path.join(outDir, ".owners", "still-options", "dir.json"), { recursive: true });
        expect(() => readStillPublishing(outDir, "dir")).toThrow(/EISDIR/);
    });
});

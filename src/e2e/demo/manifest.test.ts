import { describe, expect, it } from "vitest";
import {
    addFrame,
    assertCaptions,
    assertFps,
    assertHold,
    assertKind,
    assertScale,
    DEFAULT_FPS,
    frameFileName,
    newManifest,
    parseFilmManifest,
    resolveCaptionIndex,
    serializeManifest,
} from "./manifest.js";

const fresh = () => newManifest({ name: "tour", kind: "phone", fps: 15, scale: 2, theme: null, captions: ["one", "two"] });

describe("manifest building", () => {
    it("starts incomplete and without frames or size", () => {
        expect(fresh()).toEqual({
            version: 1,
            name: "tour",
            kind: "phone",
            fps: 15,
            scale: 2,
            theme: null,
            captions: ["one", "two"],
            width: null,
            height: null,
            complete: false,
            frames: [],
        });
    });

    it("names frames 0001.png, 0002.png and so on", () => {
        expect(frameFileName(0)).toBe("0001.png");
        expect(frameFileName(11)).toBe("0012.png");
    });

    it("the first frame fixes the size and frames are appended in order without changing the old manifest", () => {
        const first = fresh();
        const one = addFrame(first, { file: "0001.png", hold: 1.2, caption: 0 }, { width: 780, height: 1688 });
        const two = addFrame(one, { file: "0002.png", hold: 2, caption: null }, { width: 780, height: 1688 });
        expect(first.frames).toEqual([]);
        expect(two).toMatchObject({ width: 780, height: 1688, frames: [{ file: "0001.png", hold: 1.2, caption: 0 }, { file: "0002.png", hold: 2, caption: null }] });
    });

    it("refuses a frame of another size, naming the film and both sizes", () => {
        const one = addFrame(fresh(), { file: "0001.png", hold: 1, caption: null }, { width: 780, height: 1688 });
        expect(() => addFrame(one, { file: "0002.png", hold: 1, caption: null }, { width: 780, height: 600 })).toThrow(
            /film "tour": frame 2 is 780 x 600 px but the first frame is 780 x 1688/,
        );
    });
});

describe("option checks", () => {
    it("kind is desktop or phone", () => {
        expect(assertKind("desktop")).toBe("desktop");
        expect(() => assertKind("tablet")).toThrow(/kind must be "desktop" or "phone", got "tablet"/);
        expect(() => assertKind(undefined)).toThrow(/kind must be/);
    });

    it("fps defaults to 15 and must be a whole number from 1 to 60", () => {
        expect(assertFps(undefined)).toBe(DEFAULT_FPS);
        expect(assertFps(24)).toBe(24);
        for (const bad of [0, 61, 1.5, Number.NaN]) {
            expect(() => assertFps(bad)).toThrow(/fps must be a whole number from 1 to 60/);
        }
    });

    it("scale is a whole number from 1 to 4", () => {
        expect(assertScale(2, "x")).toBe(2);
        for (const bad of [0, 5, 1.5, -1]) {
            expect(() => assertScale(bad, "film()")).toThrow(/film\(\): scale must be a whole number from 1 to 4/);
        }
    });

    it("captions are an array of strings, empty by default", () => {
        expect(assertCaptions(undefined)).toEqual([]);
        expect(assertCaptions(["a", "b"])).toEqual(["a", "b"]);
        expect(() => assertCaptions("a")).toThrow(/array of strings/);
        expect(() => assertCaptions(["a", 2])).toThrow(/array of strings/);
    });

    it("hold is seconds above 0", () => {
        expect(assertHold(0.5)).toBe(0.5);
        for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => assertHold(bad)).toThrow(/hold is how many seconds/);
        }
    });

    it("a caption index must exist in the film's captions", () => {
        expect(resolveCaptionIndex(undefined, ["a"])).toBeNull();
        expect(resolveCaptionIndex(1, ["a", "b"])).toBe(1);
        expect(() => resolveCaptionIndex(2, ["a", "b"])).toThrow(/caption 2 is not an index of the film's captions \(2 given, so 0\.\.1\)/);
        expect(() => resolveCaptionIndex(0, [])).toThrow(/0 given/);
        expect(() => resolveCaptionIndex(-1, ["a"])).toThrow(/not an index/);
        expect(() => resolveCaptionIndex(0.5, ["a"])).toThrow(/not an index/);
    });
});

describe("parseFilmManifest", () => {
    const written = addFrame(fresh(), { file: "0001.png", hold: 1.5, caption: 1 }, { width: 780, height: 1688 });

    it("reads what serializeManifest wrote", () => {
        expect(parseFilmManifest(serializeManifest({ ...written, complete: true, theme: "dark" }))).toEqual({ ...written, complete: true, theme: "dark" });
    });

    it("writes a trailing newline and two-space indentation", () => {
        const text = serializeManifest(written);
        expect(text.endsWith("}\n")).toBe(true);
        expect(text).toContain('\n  "name": "tour"');
    });

    it("fails on text that is not JSON or not an object", () => {
        expect(() => parseFilmManifest("{")).toThrow(/not valid JSON/);
        expect(() => parseFilmManifest("[]")).toThrow(/must be a JSON object/);
    });

    it("refuses another version, naming the one it reads", () => {
        expect(() => parseFilmManifest(JSON.stringify({ ...written, version: 2 }))).toThrow(/version 2 is not supported .* reads version 1/);
    });

    it.each([
        [{ name: 1 }, /needs name/],
        [{ theme: "blue" }, /theme must be/],
        [{ captions: "x" }, /captions must be/],
        [{ captions: [1] }, /captions must be/],
        [{ width: "1" }, /width and height/],
        [{ frames: {} }, /frames must be an array/],
        [{ frames: [{ file: "a" }] }, /frames\[0\] must be/],
        [{ kind: "tv" }, /kind must be/],
        [{ fps: 0 }, /Film manifest: fps must be a whole number from 1 to 60, got 0/],
        [{ fps: 1000 }, /Film manifest: fps must be a whole number from 1 to 60/],
        [{ fps: 7.5 }, /Film manifest: fps must be a whole number/],
        [{ scale: 0 }, /Film manifest: scale must be a whole number from 1 to 4, got 0/],
        [{ scale: 8 }, /Film manifest: scale must be a whole number from 1 to 4/],
        [{ frames: [{ file: "../0001.png", hold: 1, caption: null }] }, /frames\[0\]\.file "..\/0001.png" must be a frame name/],
        [{ frames: [{ file: "1.png", hold: 1, caption: null }] }, /must be a frame name such as 0001.png/],
        [{ frames: [{ file: "0001.jpg", hold: 1, caption: null }] }, /must be a frame name/],
        [{ frames: [{ file: "0001.png", hold: 0, caption: null }] }, /frames\[0\]\.hold must be seconds above 0, got 0/],
        [{ frames: [{ file: "0001.png", hold: -2, caption: null }] }, /hold must be seconds above 0/],
        [{ frames: [{ file: "0001.png", hold: 1, caption: 2 }] }, /frames\[0\]\.caption 2 is not an index of captions \(2 given\)/],
        [{ frames: [{ file: "0001.png", hold: 1, caption: -1 }] }, /not an index of captions/],
        [{ frames: [{ file: "0001.png", hold: 1, caption: 0.5 }] }, /not an index of captions/],
        [{ width: null, height: null }, /needs width and height/],
        [{ height: null }, /needs width and height/],
        [{ source: { testId: "t" } }, /source must be/],
        [{ source: "x" }, /source must be/],
    ])("names the field that is wrong: %j", (patch, message) => {
        expect(() => parseFilmManifest(JSON.stringify({ ...written, ...patch }))).toThrow(message);
    });
});

describe("manifest frames and source", () => {
    it("accepts frame names of four or more digits and a null caption", () => {
        const base = addFrame(fresh(), { file: "10000.png", hold: 0.1, caption: null }, { width: 1, height: 1 });
        expect(parseFilmManifest(serializeManifest(base)).frames[0]?.file).toBe("10000.png");
    });

    it("a film without frames needs no size", () => {
        expect(parseFilmManifest(serializeManifest(fresh()))).toMatchObject({ width: null, height: null, frames: [] });
    });

    it("keeps the recording test when there is one and omits it otherwise", () => {
        const source = { testId: "abc-123", title: "tour opens", file: "e2e/tour.spec.ts" };
        const withSource = newManifest({ name: "tour", kind: "desktop", fps: 15, scale: 2, theme: null, captions: [], source });
        expect(parseFilmManifest(serializeManifest(withSource)).source).toEqual(source);
        expect(serializeManifest(fresh())).not.toContain("source");
        expect(parseFilmManifest(serializeManifest(fresh())).source).toBeUndefined();
    });
});

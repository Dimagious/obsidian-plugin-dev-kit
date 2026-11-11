import { describe, expect, it } from "vitest";
import { fakePng } from "../../test-support/demo-fakes.js";
import { assertFrameSize, readPngSize } from "./png.js";

describe("readPngSize", () => {
    it("reads the size from the IHDR chunk", () => {
        expect(readPngSize(fakePng(780, 1688))).toEqual({ width: 780, height: 1688 });
    });

    it("refuses bytes that are not a PNG", () => {
        expect(() => readPngSize(Buffer.from("not a png at all, but long enough to have a header"))).toThrow(/not a PNG/);
        expect(() => readPngSize(Buffer.alloc(3))).toThrow(/not a PNG/);
        const noIhdr = fakePng(10, 10);
        noIhdr.write("IDAT", 12, "latin1");
        expect(() => readPngSize(noIhdr)).toThrow(/not a PNG/);
    });
});

describe("assertFrameSize (the pixel density guard)", () => {
    it("passes a frame that is the CSS size times the scale", () => {
        expect(assertFrameSize(fakePng(2400, 1600), { width: 2400, height: 1600 }, 2, "film")).toEqual({ width: 2400, height: 1600 });
    });

    it("fails on a frame at half the density, saying what was expected and why it happens", () => {
        expect(() => assertFrameSize(fakePng(1200, 800), { width: 2400, height: 1600 }, 2, 'film "a", frame 1')).toThrow(
            /film "a", frame 1: the frame is 1200 x 800 px, expected 2400 x 1600 .*scale 2.*did not run at the requested pixel density/s,
        );
    });

    it("fails on one wrong side", () => {
        expect(() => assertFrameSize(fakePng(2400, 1599), { width: 2400, height: 1600 }, 2, "x")).toThrow(/2400 x 1599 px/);
    });
});

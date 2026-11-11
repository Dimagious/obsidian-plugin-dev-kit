import { describe, expect, it } from "vitest";
import { assertPadding, pixelSize, resolveClip } from "./clip.js";

const window1200 = { width: 1200, height: 800 };

describe("resolveClip", () => {
    it("returns whole pixels, snapping the rectangle outward", () => {
        expect(resolveClip({ x: 10.4, y: 20.6, width: 100.2, height: 50.3 }, 0, window1200, "t")).toEqual({ x: 10, y: 20, width: 101, height: 51 });
    });

    it("adds padding on every side", () => {
        expect(resolveClip({ x: 100, y: 100, width: 200, height: 100 }, 16, window1200, "t")).toEqual({ x: 84, y: 84, width: 232, height: 132 });
    });

    it("cuts padding at the window edge instead of failing", () => {
        expect(resolveClip({ x: 4, y: 4, width: 1192, height: 792 }, 20, window1200, "t")).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    });

    it("rounds a fractional padding up", () => {
        expect(resolveClip({ x: 100, y: 100, width: 10, height: 10 }, 0.5, window1200, "t")).toEqual({ x: 99, y: 99, width: 12, height: 12 });
    });

    it("fails when the rectangle itself runs past the window, naming where and how big the window is", () => {
        expect(() => resolveClip({ x: 0, y: 700, width: 100, height: 150 }, 0, window1200, "still \"a\"")).toThrow(
            /still "a": the clip spans x 0\.\.100, y 700\.\.850, outside the 1200 x 800 window/,
        );
        expect(() => resolveClip({ x: -1, y: 0, width: 10, height: 10 }, 0, window1200, "t")).toThrow(/outside/);
        expect(() => resolveClip({ x: 1100, y: 0, width: 101, height: 10 }, 0, window1200, "t")).toThrow(/outside/);
    });

    it("fails on a rectangle without area or with a value that is not a number", () => {
        expect(() => resolveClip({ x: 0, y: 0, width: 0, height: 10 }, 0, window1200, "t")).toThrow(/needs a width and a height above 0/);
        expect(() => resolveClip({ x: 0, y: 0, width: 10, height: -3 }, 0, window1200, "t")).toThrow(/above 0/);
        expect(() => resolveClip({ x: Number.NaN, y: 0, width: 10, height: 10 }, 0, window1200, "t")).toThrow(/x NaN, which is not a number/);
    });

    it("fails on a bad padding", () => {
        expect(() => resolveClip({ x: 0, y: 0, width: 10, height: 10 }, -1, window1200, "t")).toThrow(/padding must be/);
    });
});

describe("assertPadding and pixelSize", () => {
    it("accepts 0 and positive numbers, refuses the rest", () => {
        expect(assertPadding(0)).toBe(0);
        expect(assertPadding(12)).toBe(12);
        expect(() => assertPadding(Number.POSITIVE_INFINITY)).toThrow(/padding/);
        expect(() => assertPadding(Number.NaN)).toThrow(/padding/);
    });

    it("multiplies the CSS size by the scale", () => {
        expect(pixelSize({ width: 390, height: 844 }, 2)).toEqual({ width: 780, height: 1688 });
    });
});

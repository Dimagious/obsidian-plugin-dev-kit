import { describe, expect, it } from "vitest";
import { deviceMetrics, isReloadRejection } from "./mobile.js";

describe("deviceMetrics", () => {
    it("defaults to the 390 x 844 phone at scale 2, with Chromium's own mobile mode off", () => {
        expect(deviceMetrics()).toEqual({ width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
    });

    it("takes any of the three values and keeps the defaults for the rest", () => {
        expect(deviceMetrics({ width: 360 })).toEqual({ width: 360, height: 844, deviceScaleFactor: 2, mobile: false });
        expect(deviceMetrics({ height: 700, scale: 3 })).toEqual({ width: 390, height: 700, deviceScaleFactor: 3, mobile: false });
    });

    it("ignores an option that is undefined", () => {
        expect(deviceMetrics({ width: undefined }).width).toBe(390);
    });

    it("refuses a size that cannot be a screen, naming the option", () => {
        expect(() => deviceMetrics({ width: 0 })).toThrow("mobile(): width must be a positive number, got 0.");
        expect(() => deviceMetrics({ height: -1 })).toThrow("height");
        expect(() => deviceMetrics({ scale: Number.NaN })).toThrow("scale");
        expect(() => deviceMetrics({ scale: Infinity })).toThrow("scale");
    });
});

describe("isReloadRejection", () => {
    it("accepts what Playwright raises when the page reloads under a call", () => {
        expect(isReloadRejection(new Error("page.evaluate: Execution context was destroyed, most likely because of a navigation"))).toBe(true);
        expect(isReloadRejection(new Error("page.evaluate: Target page, context or browser has been closed"))).toBe(true);
        expect(isReloadRejection(new Error("Frame was detached"))).toBe(true);
    });

    it("does not accept a real failure", () => {
        expect(isReloadRejection(new TypeError("app.emulateMobile is not a function"))).toBe(false);
        expect(isReloadRejection("something else")).toBe(false);
    });
});

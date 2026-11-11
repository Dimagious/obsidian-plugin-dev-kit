import { describe, expect, it } from "vitest";
import { DEMO_PRESETS, presetViewport } from "./presets.js";

describe("presets", () => {
    it("every preset is a whole CSS window at its scale, so the PNG has exactly the preset's pixels", () => {
        for (const name of Object.keys(DEMO_PRESETS)) {
            const viewport = presetViewport(name);
            expect(Number.isInteger(viewport.cssWidth)).toBe(true);
            expect(Number.isInteger(viewport.cssHeight)).toBe(true);
            expect(viewport.cssWidth * viewport.scale).toBe(viewport.width);
            expect(viewport.cssHeight * viewport.scale).toBe(viewport.height);
        }
    });

    it("has the destinations of the plan", () => {
        expect(presetViewport("listing-desktop")).toMatchObject({ width: 1200, height: 800, cssWidth: 1200, cssHeight: 800, scale: 1 });
        expect(presetViewport("listing-phone")).toMatchObject({ width: 900, height: 1600, cssWidth: 450, cssHeight: 800, scale: 2 });
        expect(presetViewport("social")).toMatchObject({ width: 1200, height: 630 });
        expect(presetViewport("readme").width).toBeLessThanOrEqual(1000);
    });

    it("refuses an unknown preset, also one that is a property of Object", () => {
        expect(() => presetViewport("poster")).toThrow(/Unknown still preset "poster". Known presets: readme, listing-desktop, listing-phone, social/);
        expect(() => presetViewport("toString")).toThrow(/Unknown still preset/);
    });
});

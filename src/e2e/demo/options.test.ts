import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDemoOptions } from "./options.js";

describe("resolveDemoOptions", () => {
    it("defaults to .opdk/demo at the plugin root, scale 2 and no forbidden selectors", () => {
        expect(resolveDemoOptions(undefined, "/work/plugin")).toEqual({
            outDir: path.resolve("/work/plugin", ".opdk/demo"),
            scale: 2,
            forbiddenSelectors: [],
        });
    });

    it("takes every option and resolves outDir against the working directory", () => {
        expect(resolveDemoOptions({ outDir: "docs/film", scale: 1, forbiddenSelectors: [".secret", "#key"] }, "/work/plugin")).toEqual({
            outDir: "/work/plugin/docs/film",
            scale: 1,
            forbiddenSelectors: [".secret", "#key"],
        });
    });

    it("keeps defaults for the keys that are left out", () => {
        expect(resolveDemoOptions({ scale: 3 }, "/w")).toMatchObject({ outDir: path.resolve("/w", ".opdk/demo"), scale: 3 });
    });

    it("rejects what is not an object, naming the option", () => {
        expect(() => resolveDemoOptions("x", "/w")).toThrow('"demo" must be an object');
        expect(() => resolveDemoOptions([], "/w")).toThrow('"demo" must be an object');
    });

    it("rejects an unknown key, listing the known ones", () => {
        expect(() => resolveDemoOptions({ outdir: "x" }, "/w")).toThrow('unknown key "demo.outdir". Known keys: outDir, scale, forbiddenSelectors');
    });

    it.each([
        [{ outDir: "" }, '"demo.outDir" must be a non-empty string'],
        [{ outDir: 3 }, '"demo.outDir"'],
        [{ scale: 0 }, '"demo.scale" must be a whole number from 1 to 4'],
        [{ scale: 2.5 }, '"demo.scale"'],
        [{ scale: 5 }, '"demo.scale"'],
        [{ scale: "2" }, '"demo.scale"'],
        [{ forbiddenSelectors: ".a" }, '"demo.forbiddenSelectors" must be an array'],
        [{ forbiddenSelectors: [".a", ""] }, '"demo.forbiddenSelectors" must be an array'],
        [{ forbiddenSelectors: [1] }, '"demo.forbiddenSelectors" must be an array'],
    ])("rejects %j", (value, message) => {
        expect(() => resolveDemoOptions(value, "/w")).toThrow(message);
    });
});

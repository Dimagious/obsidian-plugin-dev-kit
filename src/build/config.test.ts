import { describe, expect, it } from "vitest";
import { validateBuildConfig } from "./config.js";

const check = (value: unknown): unknown => validateBuildConfig(value, "opdk.config.mjs");

describe("validateBuildConfig", () => {
    it("accepts an empty section", () => {
        expect(check({})).toEqual({});
    });

    it("copies every known key", () => {
        const config = {
            entry: "src/index.ts",
            outfile: "dist/main.js",
            minify: false,
            target: "es2022",
            external: ["yaml"],
            loader: { ".png": "dataurl" },
            css: { entry: "css/main.css", outfile: "styles.css" },
        };
        expect(check(config)).toEqual(config);
    });

    it("accepts css: false", () => {
        expect(check({ css: false })).toEqual({ css: false });
    });

    it("accepts a partial css object", () => {
        expect(check({ css: { entry: "a.css" } })).toEqual({ css: { entry: "a.css" } });
    });

    it.each([null, [], "x", 3])("rejects a non-object section %j", (value) => {
        expect(() => check(value)).toThrow('"build" must be an object');
    });

    it("rejects unknown keys and lists the allowed ones", () => {
        expect(() => check({ minifiy: true })).toThrow(
            /unknown key\(s\) in "build": minifiy\. Allowed keys: entry, outfile, minify/,
        );
    });

    it("rejects unknown css keys", () => {
        expect(() => check({ css: { input: "a.css" } })).toThrow('unknown key(s) in "build.css": input');
    });

    it.each([
        [{ entry: 1 }, "build.entry"],
        [{ entry: "" }, "build.entry"],
        [{ outfile: false }, "build.outfile"],
        [{ target: 6 }, "build.target"],
        [{ minify: "yes" }, "build.minify"],
        [{ external: "yaml" }, "build.external"],
        [{ external: ["ok", 1] }, "build.external"],
        [{ external: [""] }, "build.external"],
        [{ loader: [] }, "build.loader"],
        [{ loader: { png: "dataurl" } }, 'key "png" must start with a dot'],
        [{ loader: { ".png": "images" } }, 'build.loader[".png"]'],
        [{ loader: { ".png": 1 } }, 'build.loader[".png"]'],
        [{ css: true }, "build.css"],
        [{ css: "src/styles" }, "build.css"],
        [{ css: { entry: 1 } }, "build.css.entry"],
        [{ css: { outfile: "" } }, "build.css.outfile"],
    ])("rejects %j naming %s", (value, fragment) => {
        expect(() => check(value)).toThrow(fragment);
    });

    it("prefixes errors with the config file", () => {
        expect(() => validateBuildConfig({ minify: 1 }, "/p/opdk.config.mjs")).toThrow(/^\/p\/opdk\.config\.mjs: /);
    });
});

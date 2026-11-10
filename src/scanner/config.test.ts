import { describe, expect, it } from "vitest";
import { validateScanConfig } from "./config.js";

const check = (value: unknown): unknown => validateScanConfig(value, "opdk.config.mjs");

describe("validateScanConfig", () => {
    it("accepts an empty section", () => {
        expect(check({})).toEqual({});
    });

    it("copies ignore", () => {
        expect(check({ ignore: ["site/**", "design/**"] })).toEqual({ ignore: ["site/**", "design/**"] });
    });

    it("accepts an empty ignore list", () => {
        expect(check({ ignore: [] })).toEqual({ ignore: [] });
    });

    it.each([null, [], "x", 3])("rejects a non-object section %j", (value) => {
        expect(() => check(value)).toThrow('opdk.config.mjs: "scan" must be an object.');
    });

    it("rejects unknown keys and lists the allowed ones", () => {
        expect(() => check({ ignores: [] })).toThrow('unknown key(s) in "scan": ignores. Allowed keys: ignore.');
    });

    it.each(["site/**", 5, [5], [null]])("rejects ignore %j that is not an array of strings", (value) => {
        expect(() => check({ ignore: value })).toThrow('"scan.ignore" must be an array of glob strings');
    });

    it("names the pattern that is unusable", () => {
        expect(() => check({ ignore: ["site/**", "{a,b}"] })).toThrow('"scan.ignore" pattern "{a,b}" uses {}');
        expect(() => check({ ignore: [""] })).toThrow('"scan.ignore" pattern "" is empty');
    });
});

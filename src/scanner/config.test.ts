import { describe, expect, it } from "vitest";
import { validateScanConfig } from "./config.js";

const check = (value: unknown): unknown => validateScanConfig(value, "opdk.config.mjs");

describe("validateScanConfig", () => {
    it("accepts an empty section", () => {
        expect(check({})).toEqual({});
    });

    it.each([null, [], "x", 3])("rejects a non-object section %j", (value) => {
        expect(() => check(value)).toThrow('opdk.config.mjs: "scan" must be an object.');
    });

    it("rejects the removed ignore key, in any shape, and says what to do instead", () => {
        for (const value of [["site/**"], [], "site/**"]) {
            expect(() => check({ ignore: value })).toThrow(
                /opdk\.config\.mjs: "scan\.ignore" was removed\..*still lowers the scorecard.*Delete the key and fix what `opdk scan` reports, or untrack the file\./,
            );
        }
    });

    it("rejects any other key and says the section has none", () => {
        expect(() => check({ ignores: [] })).toThrow('unknown key(s) in "scan": ignores. The "scan" section has no keys.');
    });
});

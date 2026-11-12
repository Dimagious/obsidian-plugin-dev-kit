import { describe, expect, it } from "vitest";
import { checkRule, formatPeerError, parseVersion, type PeerRule } from "./versions.js";

const RULE: PeerRule = { name: "pkg", minMajor: 5, maxMajor: 5, range: "^5.0.0" };

describe("parseVersion", () => {
    it("reads major and minor, with a v prefix and a pre-release tag", () => {
        expect(parseVersion("5.1.0")).toEqual({ major: 5, minor: 1 });
        expect(parseVersion("v44.10.2")).toEqual({ major: 44, minor: 10 });
        expect(parseVersion("5.0.0-beta.1")).toEqual({ major: 5, minor: 0 });
    });

    it("returns undefined for text that is not a version", () => {
        expect(parseVersion("")).toBeUndefined();
        expect(parseVersion("latest")).toBeUndefined();
        expect(parseVersion("5.1")).toBeUndefined();
    });
});

describe("checkRule", () => {
    it("accepts a version inside the range", () => {
        expect(checkRule(RULE, "5.0.0")).toBeUndefined();
        expect(checkRule(RULE, "5.9.3")).toBeUndefined();
    });

    it("reports a missing package with the install spec", () => {
        expect(checkRule(RULE, undefined)).toEqual({ message: '"pkg" is not installed; the kit needs ^5.0.0.', install: "pkg@^5.0.0" });
    });

    it("rejects a major below and above the range", () => {
        expect(checkRule(RULE, "4.9.9")?.message).toBe('"pkg" 4.9.9 is installed; the kit needs ^5.0.0.');
        expect(checkRule(RULE, "6.0.0")?.message).toBe('"pkg" 6.0.0 is installed; the kit needs ^5.0.0.');
    });

    it("has no upper bound without maxMajor", () => {
        const open: PeerRule = { name: "pkg", minMajor: 30, range: ">=30.0.0" };
        expect(checkRule(open, "30.0.0")).toBeUndefined();
        expect(checkRule(open, "41.2.0")).toBeUndefined();
        expect(checkRule(open, "26.1.0")).toBeDefined();
    });

    it("honours a minimum minor inside the lowest major", () => {
        const rule: PeerRule = { name: "pw", minMajor: 1, minMinor: 62, range: "^1.62.0" };
        expect(checkRule(rule, "1.61.9")).toBeDefined();
        expect(checkRule(rule, "1.62.0")).toBeUndefined();
        expect(checkRule(rule, "2.0.0")).toBeUndefined();
    });

    it("reports a version string that cannot be read", () => {
        expect(checkRule(RULE, "next")?.message).toContain('reports the version "next"');
    });
});

describe("formatPeerError", () => {
    it("quotes a spec the shell would read as a redirect", () => {
        const text = formatPeerError("x", [{ message: "m.", install: "electron@>=39.0.0" }, { message: "n.", install: "a@^1" }]);
        expect(text).toContain('Run: npm install --save-dev "electron@>=39.0.0" a@^1');
    });

    it("quotes a spec with a pipe or whitespace", () => {
        const text = formatPeerError("x", [{ message: "m.", install: "x@^1 || ^2" }, { message: "n.", install: "y@^1||^2" }]);
        expect(text).toContain('Run: npm install --save-dev "x@^1 || ^2" "y@^1||^2"');
    });

    it("lists every problem and ends with one install command", () => {
        const text = formatPeerError("defineUnitConfig()", [
            { message: "a is wrong.", install: "a@^1" },
            { message: "b is wrong.", install: "b@^2" },
        ]);
        expect(text).toBe("defineUnitConfig(): a is wrong.\ndefineUnitConfig(): b is wrong.\nRun: npm install --save-dev a@^1 b@^2");
    });
});

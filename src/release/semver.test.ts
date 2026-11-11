import { describe, expect, it } from "vitest";
import { bumpVersion, compareVersions, isBumpKind, isPlainVersion, isSemver } from "./semver.js";

describe("isPlainVersion / isSemver", () => {
    it("accepts x.y.z only as a plain version", () => {
        expect(isPlainVersion("1.2.3")).toBe(true);
        expect(isPlainVersion("10.0.12")).toBe(true);
        for (const bad of ["v1.2.3", "1.2", "1.2.3-beta.1", "1.2.3.4", "", "1.2.x", " 1.2.3"]) {
            expect(isPlainVersion(bad), bad).toBe(false);
        }
    });

    it("accepts a pre-release suffix as semver, like the official action", () => {
        expect(isSemver("1.2.3-beta.1")).toBe(true);
        expect(isSemver("1.2.3")).toBe(true);
        expect(isSemver("1.2")).toBe(false);
        expect(isSemver("v1.2.3")).toBe(false);
    });
});

describe("compareVersions", () => {
    it("compares the numbers, not the text", () => {
        expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
        expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
        expect(compareVersions("0.15.0", "1.0.0")).toBeLessThan(0);
        expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    });

    it("puts a pre-release below its release", () => {
        expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
        expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
        expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
        expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0);
    });

    it("returns undefined for text that is not a version", () => {
        expect(compareVersions("latest", "1.0.0")).toBeUndefined();
        expect(compareVersions("1.0.0", "1.0")).toBeUndefined();
    });
});

describe("bumpVersion", () => {
    it("bumps patch, minor and major and zeroes what follows", () => {
        expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
        expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
        expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
        expect(bumpVersion("0.9.9", "patch")).toBe("0.9.10");
    });

    it("refuses a version that is not x.y.z", () => {
        expect(() => bumpVersion("1.2.3-beta.1", "patch")).toThrow(/not an x\.y\.z version/);
        expect(() => bumpVersion("v1.2.3", "minor")).toThrow(/not an x\.y\.z version/);
    });
});

describe("isBumpKind", () => {
    it("knows the three kinds", () => {
        expect(["patch", "minor", "major"].every(isBumpKind)).toBe(true);
        expect(isBumpKind("prerelease")).toBe(false);
    });
});

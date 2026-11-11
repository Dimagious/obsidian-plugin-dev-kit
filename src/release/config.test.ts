import { describe, expect, it } from "vitest";
import { validateReleaseConfig } from "./config.js";

describe("validateReleaseConfig", () => {
    it("accepts an empty section and both keys", () => {
        expect(validateReleaseConfig({}, "c")).toEqual({});
        expect(validateReleaseConfig({ changelog: "docs/CHANGES.md", defaultBranch: "master" }, "c")).toEqual({ changelog: "docs/CHANGES.md", defaultBranch: "master" });
    });

    it("rejects a section that is not an object", () => {
        for (const bad of ["x", null, [], 3]) {
            expect(() => validateReleaseConfig(bad, "c")).toThrow('c: "release" must be an object.');
        }
    });

    it("names an unknown key and the allowed ones", () => {
        expect(() => validateReleaseConfig({ branch: "main" }, "c")).toThrow('c: unknown key(s) in "release": branch. Allowed keys: changelog, defaultBranch.');
    });

    it("names the key whose value is not a non-empty string", () => {
        expect(() => validateReleaseConfig({ changelog: 3 }, "c")).toThrow('"release.changelog" must be a non-empty string');
        expect(() => validateReleaseConfig({ defaultBranch: "" }, "c")).toThrow('"release.defaultBranch" must be a non-empty string');
    });

    it("keeps the changelog inside the plugin folder", () => {
        expect(() => validateReleaseConfig({ changelog: "../CHANGELOG.md" }, "c")).toThrow(/inside the plugin folder/);
        expect(() => validateReleaseConfig({ changelog: "/etc/CHANGELOG.md" }, "c")).toThrow(/inside the plugin folder/);
    });
});

import { describe, expect, it } from "vitest";
import { compareObsidianVersions, isExplicitVersion, normalizeVersion } from "./version.js";

describe("isExplicitVersion", () => {
    it.each(["1.14.5", "0.0.1", "10.20.30"])("accepts %s", (value) => {
        expect(isExplicitVersion(value)).toBe(true);
    });

    it.each(["latest", "public-latest", "1.14", "1.14.5.1", "v1.14.5", "1.14.5-beta", " 1.14.5", ""])(
        "rejects %j",
        (value) => {
            expect(isExplicitVersion(value)).toBe(false);
        },
    );
});

describe("normalizeVersion", () => {
    it("trims", () => {
        expect(normalizeVersion(" 1.14.5\n")).toBe("1.14.5");
    });

    it.each([undefined, null, "", "   "])("returns null for %j", (value) => {
        expect(normalizeVersion(value)).toBeNull();
    });
});

describe("compareObsidianVersions", () => {
    it("matches the same version, ignoring surrounding whitespace", () => {
        expect(compareObsidianVersions("1.14.5", " 1.14.5 ")).toEqual({ status: "match", message: "Obsidian 1.14.5" });
    });

    it("reports a mismatch and names both versions", () => {
        const verdict = compareObsidianVersions("1.13.7", "1.14.5");
        expect(verdict.status).toBe("mismatch");
        expect(verdict.message).toContain("expected 1.13.7");
        expect(verdict.message).toContain("1.14.5 is running");
    });

    it("does not treat a newer patch as close enough", () => {
        expect(compareObsidianVersions("1.14.5", "1.14.6").status).toBe("mismatch");
    });

    it("is unknown when the running version cannot be read", () => {
        expect(compareObsidianVersions("1.14.5", null).status).toBe("unknown");
        expect(compareObsidianVersions("1.14.5", "").status).toBe("unknown");
    });

    it("is unknown, not a match, when nothing was expected", () => {
        const verdict = compareObsidianVersions(undefined, "1.14.5");
        expect(verdict.status).toBe("unknown");
        expect(verdict.message).toContain("1.14.5");
    });

    it("prefers the unreadable-renderer message when both sides are missing", () => {
        expect(compareObsidianVersions(null, null).message).toContain("renderer");
    });
});

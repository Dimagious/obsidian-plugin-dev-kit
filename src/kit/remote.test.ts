import { describe, expect, it } from "vitest";
import { LS_REMOTE, NEW_SHA, OLD_SHA } from "../test-support/kit-fixture.js";
import { kitChangelogUrl, kitRepositoryUrl, latestTag, parseKitTags, sortedTags } from "./remote.js";

describe("parseKitTags", () => {
    it("keeps vX.Y.Z tags only and prefers the peeled commit of an annotated tag", () => {
        expect([...parseKitTags(LS_REMOTE)]).toEqual([
            ["v0.1.0", OLD_SHA],
            ["v0.2.0", NEW_SHA],
        ]);
    });

    it("returns nothing for empty or foreign output", () => {
        expect(parseKitTags("").size).toBe(0);
        expect(parseKitTags("warning: redirecting\nnot a ref line\n").size).toBe(0);
    });
});

describe("latestTag", () => {
    it("is the highest version, not the last listed", () => {
        const output = ["10", "9", "2"].map((minor, index) => `${String(index + 1).repeat(40)}\trefs/tags/v0.${minor}.0`).join("\n");
        const tags = parseKitTags(output);
        expect(sortedTags(tags)).toEqual(["v0.10.0", "v0.9.0", "v0.2.0"]);
        expect(latestTag(tags)).toBe("v0.10.0");
    });

    it("is undefined without tags", () => {
        expect(latestTag(new Map())).toBeUndefined();
    });
});

describe("urls", () => {
    it("point at the owner's kit repository", () => {
        expect(kitRepositoryUrl("me")).toBe("https://github.com/me/obsidian-plugin-dev-kit.git");
        expect(kitChangelogUrl("me", "v0.2.0")).toBe("https://raw.githubusercontent.com/me/obsidian-plugin-dev-kit/v0.2.0/CHANGELOG.md");
    });
});

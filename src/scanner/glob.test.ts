import { describe, expect, it } from "vitest";
import { createIgnoreMatcher, describeGlobProblem } from "./glob.js";

describe("createIgnoreMatcher", () => {
    it("matches nothing without patterns", () => {
        expect(createIgnoreMatcher([])("site/a.css")).toBe(false);
    });

    it("matches everything under a folder with /**", () => {
        const ignored = createIgnoreMatcher(["site/**"]);
        expect(ignored("site/a.css")).toBe(true);
        expect(ignored("site/assets/site.js")).toBe(true);
        expect(ignored("src/site/a.css")).toBe(false);
        expect(ignored("website/a.css")).toBe(false);
    });

    it("anchors a pattern to the whole path", () => {
        const ignored = createIgnoreMatcher(["*.min.js"]);
        expect(ignored("a.min.js")).toBe(true);
        expect(ignored("vendor/a.min.js")).toBe(false);
        expect(ignored("a.min.json")).toBe(false);
    });

    it("lets **/ match any depth, including none", () => {
        const ignored = createIgnoreMatcher(["**/*.min.js"]);
        expect(ignored("a.min.js")).toBe(true);
        expect(ignored("vendor/deep/a.min.js")).toBe(true);
        expect(ignored("vendor/a.js")).toBe(false);
    });

    it("keeps * inside one path segment and ? to one character", () => {
        const ignored = createIgnoreMatcher(["src/*.ts", "docs/v?.md"]);
        expect(ignored("src/a.ts")).toBe(true);
        expect(ignored("src/deep/a.ts")).toBe(false);
        expect(ignored("docs/v1.md")).toBe(true);
        expect(ignored("docs/v10.md")).toBe(false);
        expect(ignored("docs/v/.md")).toBe(false);
    });

    it("treats regular-expression characters in a pattern literally", () => {
        const ignored = createIgnoreMatcher(["a+b(1).css", "x.y"]);
        expect(ignored("a+b(1).css")).toBe(true);
        expect(ignored("aab(1).css")).toBe(false);
        expect(ignored("x.y")).toBe(true);
        expect(ignored("xzy")).toBe(false);
    });

    it("matches when any pattern does", () => {
        const ignored = createIgnoreMatcher(["design/**", "site/**"]);
        expect(ignored("design/a.css")).toBe(true);
        expect(ignored("site/a.css")).toBe(true);
        expect(ignored("src/a.css")).toBe(false);
    });

    it("throws on an unusable pattern, quoting it", () => {
        expect(() => createIgnoreMatcher(["{a,b}/**"])).toThrow('Ignore pattern "{a,b}/**" uses {}');
    });
});

describe("describeGlobProblem", () => {
    it("accepts the supported subset", () => {
        expect(describeGlobProblem("site/**")).toBeUndefined();
        expect(describeGlobProblem("**/*.min.js")).toBeUndefined();
        expect(describeGlobProblem("a?.css")).toBeUndefined();
    });

    it.each([
        ["", "is empty"],
        ["!site/**", "uses {}"],
        ["a/[ab].css", "uses {}"],
        ["a\\b", "uses {}"],
        ["/site/**", "relative to the plugin root"],
        ["./site/**", "relative to the plugin root"],
        ["../site/**", 'must not contain ".."'],
        ["a/../b", 'must not contain ".."'],
    ])("rejects %j", (pattern, reason) => {
        expect(describeGlobProblem(pattern)).toContain(reason);
    });
});

import { describe, expect, it } from "vitest";
import { describeDifference, firstDifference, LIKELY_CAUSES, LIKELY_CAUSES_SAME_TREE } from "./reproducible.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("firstDifference", () => {
    it("is undefined for equal bytes, empty files included", () => {
        expect(firstDifference(bytes("abc"), bytes("abc"))).toBeUndefined();
        expect(firstDifference(bytes(""), bytes(""))).toBeUndefined();
    });

    it("gives the offset, line and column of the first differing byte", () => {
        const difference = firstDifference(bytes("one\ntwo\nthree"), bytes("one\ntwo\nthrEe"));
        expect(difference).toMatchObject({ offset: 11, line: 3, column: 4 });
        expect(difference?.first).toContain("three");
        expect(difference?.second).toContain("thrEe");
    });

    it("finds a difference at the very first byte", () => {
        expect(firstDifference(bytes("a"), bytes("b"))).toMatchObject({ offset: 0, line: 1, column: 1 });
    });

    it("reports where the shorter file ends when one is a prefix of the other", () => {
        expect(firstDifference(bytes("abc"), bytes("abcd"))).toMatchObject({ offset: 3 });
        expect(firstDifference(bytes("abcd"), bytes("abc"))).toMatchObject({ offset: 3 });
    });

    it("quotes the context so control characters stay readable", () => {
        const difference = firstDifference(bytes("a\nb"), bytes("a\nc"));
        expect(difference?.first).toBe('"a\\nb"');
    });
});

describe("describeDifference", () => {
    it("names the file, the offset, the sizes and both contexts", () => {
        const a = bytes("var t=1700000000000;");
        const b = bytes("var t=1700000000001;");
        const difference = firstDifference(a, b);
        expect(difference).toBeDefined();
        const text = describeDifference("main.js", "two builds", a, b, difference ?? { offset: 0, line: 0, column: 0, first: "", second: "" });
        expect(text).toContain("main.js differs between two builds: first difference at byte 18 (line 1, column 19)");
        expect(text).toContain("20 and 20 bytes");
    });

    it("lists the likely causes the owner can act on, and what is not compared", () => {
        for (const cause of ["git does not hold", "absolute path", "random id", "uncommitted"]) {
            expect(LIKELY_CAUSES).toContain(cause);
        }
        for (const gap of ["Node and esbuild versions", "lockfile drift", "line endings"]) {
            expect(LIKELY_CAUSES).toContain(gap);
        }
    });

    it("says the same-folder fallback cannot see untracked files or paths", () => {
        expect(LIKELY_CAUSES_SAME_TREE).toContain("timestamp");
        expect(LIKELY_CAUSES_SAME_TREE).toContain("cannot see files git does not hold or absolute paths");
    });
});

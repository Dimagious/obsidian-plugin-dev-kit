import { describe, expect, it } from "vitest";
import { findingsOf, formatFinding, sortFindings, type Finding } from "./findings.js";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
    check: "lint",
    file: "src/a.ts",
    line: 3,
    rule: "obsidianmd/x",
    message: "Do not.",
    ...overrides,
});

describe("formatFinding", () => {
    it("prints file:line, the rule and the message", () => {
        expect(formatFinding(finding())).toBe("src/a.ts:3  obsidianmd/x  Do not.");
    });
});

describe("sortFindings", () => {
    it("orders by file, then line (numerically), then rule, then message", () => {
        const sorted = sortFindings([
            finding({ file: "src/b.ts", line: 1 }),
            finding({ file: "src/a.ts", line: 10 }),
            finding({ file: "src/a.ts", line: 9, rule: "z" }),
            finding({ file: "src/a.ts", line: 9, rule: "a", message: "two" }),
            finding({ file: "src/a.ts", line: 9, rule: "a", message: "one" }),
        ]);
        expect(sorted.map((item) => `${item.file}:${String(item.line)}:${item.rule}:${item.message}`)).toEqual([
            "src/a.ts:9:a:one",
            "src/a.ts:9:a:two",
            "src/a.ts:9:z:Do not.",
            "src/a.ts:10:obsidianmd/x:Do not.",
            "src/b.ts:1:obsidianmd/x:Do not.",
        ]);
    });

    it("does not change its input", () => {
        const input = [finding({ line: 2 }), finding({ line: 1 })];
        sortFindings(input);
        expect(input.map((item) => item.line)).toEqual([2, 1]);
    });
});

describe("findingsOf", () => {
    it("keeps one check, sorted", () => {
        const all = [finding({ check: "css", line: 2 }), finding({ check: "lint" }), finding({ check: "css", line: 1 })];
        expect(findingsOf(all, "css").map((item) => item.line)).toEqual([1, 2]);
        expect(findingsOf(all, "meta")).toEqual([]);
    });
});

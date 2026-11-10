import { describe, expect, it } from "vitest";
import { createContext } from "../test-support/plugin-fixture.js";
import type { Finding } from "./findings.js";
import { reportCheck } from "./run.js";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
    check: "css",
    file: "styles.css",
    line: 2,
    rule: "css-no-has",
    message: "No :has().",
    ...overrides,
});

describe("reportCheck", () => {
    it("prints a ✓ line with the scope when the check found nothing", () => {
        const ctx = createContext("/p");
        expect(reportCheck("css", [finding({ check: "lint" })], "3 files", ctx.reporter)).toBe(0);
        expect(ctx.out.join("")).toBe("✓ css     0 findings (3 files)\n");
        expect(ctx.err).toEqual([]);
    });

    it("prints the failing findings under a ✗ line on stderr, sorted, and returns their number", () => {
        const ctx = createContext("/p");
        const failing = reportCheck("css", [finding({ file: "b.css", line: 1 }), finding({ line: 9 }), finding({ line: 3 })], "2 files", ctx.reporter);
        expect(failing).toBe(3);
        expect(ctx.err.join("")).toBe(
            [
                "✗ css     3 findings (2 files):",
                "            b.css:1  css-no-has  No :has().",
                "            styles.css:3  css-no-has  No :has().",
                "            styles.css:9  css-no-has  No :has().",
                "",
            ].join("\n"),
        );
        expect(ctx.out).toEqual([]);
    });

    it("says 1 finding, not 1 findings", () => {
        const ctx = createContext("/p");
        reportCheck("css", [finding()], "1 file", ctx.reporter);
        expect(ctx.err.join("")).toContain("✗ css     1 finding (1 file):");
    });

    it("prints an advisory finding as a warning and does not count it", () => {
        const ctx = createContext("/p");
        const advisory = finding({ check: "code", file: "src/a.ts", line: 4, rule: "ts-suppression", message: "Prefer types.", advisory: true });
        expect(reportCheck("code", [advisory], "1 file", ctx.reporter)).toBe(0);
        expect(ctx.out.join("")).toBe("! code    src/a.ts:4  ts-suppression  Prefer types.\n✓ code    0 findings (1 file)\n");
        expect(ctx.err).toEqual([]);
    });

    it("counts only the failing findings when advisory ones come with them", () => {
        const ctx = createContext("/p");
        const advisory = finding({ advisory: true, line: 1, rule: "ts-suppression" });
        expect(reportCheck("css", [advisory, finding({ line: 2 })], "1 file", ctx.reporter)).toBe(1);
        expect(ctx.err.join("")).toContain("✗ css     1 finding (1 file):");
        expect(ctx.err.join("")).not.toContain("ts-suppression");
        expect(ctx.out.join("")).toContain("! css     styles.css:1  ts-suppression");
    });
});

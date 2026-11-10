import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { describeEslintMismatch, eslintMismatchWarning, majorOf, readEslintVersionNextToObsidianmd } from "./eslint-nesting.js";

describe("majorOf", () => {
    it.each([
        ["10.14.0", 10],
        ["9.39.5", 9],
        ["v9.0.0", 9],
        ["10.0.0-rc.1", 10],
    ])("reads the major of %s", (version, major) => {
        expect(majorOf(version)).toBe(major);
    });

    it.each(["", "latest", "x.1.0"])("returns undefined for %j", (version) => {
        expect(majorOf(version)).toBeUndefined();
    });
});

describe("describeEslintMismatch", () => {
    it("is silent when the majors agree, whatever the minor", () => {
        expect(describeEslintMismatch("10.14.0", "10.2.1")).toBeUndefined();
        expect(describeEslintMismatch("9.39.5", "9.19.0")).toBeUndefined();
    });

    it("names both versions, the missing rules and the fix when the majors differ", () => {
        const message = describeEslintMismatch("10.14.0", "9.39.5");
        expect(message).toContain("ESLint 9.39.5");
        expect(message).toContain("ESLint 10.14.0 runs");
        expect(message).toContain("preserve-caught-error");
        expect(message).toContain('"overrides": { "eslint": "$eslint" }');
    });

    it("also warns in the other direction", () => {
        expect(describeEslintMismatch("9.39.5", "10.14.0")).toContain("ESLint 10.14.0");
    });

    it("stays silent about a version it cannot read, instead of guessing", () => {
        expect(describeEslintMismatch("10.14.0", "unknown")).toBeUndefined();
    });
});

describe("eslintMismatchWarning", () => {
    it("uses the injected resolver", () => {
        expect(eslintMismatchWarning("10.14.0", () => "9.39.5")).toContain('"overrides": { "eslint": "$eslint" }');
        expect(eslintMismatchWarning("10.14.0", () => "10.14.0")).toBeUndefined();
    });

    it("reports a resolver that fails, with its message, instead of swallowing it", () => {
        const warning = eslintMismatchWarning("10.14.0", () => {
            throw new Error("Cannot find module 'eslint/package.json'");
        });
        expect(warning).toContain("could not read the ESLint version");
        expect(warning).toContain("Cannot find module 'eslint/package.json'");
    });
});

describe("readEslintVersionNextToObsidianmd", () => {
    it("finds the ESLint of this install, which is the one that runs in the kit's own tree", () => {
        expect(readEslintVersionNextToObsidianmd()).toBe(ESLint.version);
        expect(eslintMismatchWarning()).toBeUndefined();
    });
});

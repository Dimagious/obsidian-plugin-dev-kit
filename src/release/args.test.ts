import { describe, expect, it } from "vitest";
import { parseReleaseArgs, resolveVersion } from "./args.js";

const ALL = { build: true, reproducible: true, api: true };
const PUSH = { push: true, timeoutMinutes: undefined, zip: false };

describe("parseReleaseArgs", () => {
    it("parses check with every check on by default", () => {
        expect(parseReleaseArgs(["check"])).toEqual({ mode: "check", tag: undefined, flags: ALL });
    });

    it("parses the skip flags and --tag in both spellings", () => {
        expect(parseReleaseArgs(["check", "--no-build", "--tag", "1.2.3"])).toEqual({ mode: "check", tag: "1.2.3", flags: { ...ALL, build: false } });
        expect(parseReleaseArgs(["check", "--tag=1.2.3", "--no-api", "--no-reproducible"])).toEqual({ mode: "check", tag: "1.2.3", flags: { build: true, reproducible: false, api: false } });
    });

    it("parses a bump kind or an exact version, with --dry-run", () => {
        expect(parseReleaseArgs(["minor"])).toEqual({ mode: "bump", spec: { kind: "bump", bump: "minor" }, dryRun: false, flags: ALL, pushing: PUSH });
        expect(parseReleaseArgs(["2.0.0", "--dry-run", "--no-build"])).toEqual({ mode: "bump", spec: { kind: "exact", version: "2.0.0" }, dryRun: true, flags: { ...ALL, build: false }, pushing: PUSH });
    });

    it("parses the push options of a release", () => {
        expect(parseReleaseArgs(["patch", "--no-push"])).toMatchObject({ mode: "bump", pushing: { push: false } });
        expect(parseReleaseArgs(["patch", "--timeout", "30", "--zip"])).toMatchObject({ pushing: { push: true, timeoutMinutes: 30, zip: true } });
        expect(parseReleaseArgs(["patch", "--timeout=5"])).toMatchObject({ pushing: { timeoutMinutes: 5 } });
        expect(() => parseReleaseArgs(["patch", "--no-push", "--zip"])).toThrow(/describe the push flow/);
        expect(() => parseReleaseArgs(["patch", "--timeout", "0"])).toThrow(/whole number of minutes/);
        expect(() => parseReleaseArgs(["patch", "--timeout", "soon"])).toThrow(/whole number of minutes/);
        expect(() => parseReleaseArgs(["patch", "--timeout"])).toThrow(/whole number of minutes/);
    });

    it("parses publish with an optional version", () => {
        expect(parseReleaseArgs(["publish"])).toEqual({ mode: "publish", version: undefined, pushing: PUSH });
        expect(parseReleaseArgs(["publish", "1.2.3", "--timeout", "40", "--zip"])).toEqual({ mode: "publish", version: "1.2.3", pushing: { push: true, timeoutMinutes: 40, zip: true } });
        expect(() => parseReleaseArgs(["publish", "v1.2.3"])).toThrow(/not an x\.y\.z version/);
        expect(() => parseReleaseArgs(["publish", "1.2.3", "1.2.4"])).toThrow('Unknown argument "1.2.4"');
        expect(() => parseReleaseArgs(["publish", "--dry-run"])).toThrow(/"--dry-run" does not belong to "opdk release publish"/);
        expect(() => parseReleaseArgs(["publish", "--no-push"])).toThrow(/does not belong/);
    });

    it("parses notes with an optional version and no flags", () => {
        expect(parseReleaseArgs(["notes"])).toEqual({ mode: "notes", version: undefined });
        expect(parseReleaseArgs(["notes", "1.2.3"])).toEqual({ mode: "notes", version: "1.2.3" });
        expect(() => parseReleaseArgs(["notes", "--zip"])).toThrow(/does not belong to "opdk release notes"/);
        expect(() => parseReleaseArgs(["notes", "latest"])).toThrow(/not an x\.y\.z version/);
    });

    it("keeps the push options out of check", () => {
        expect(() => parseReleaseArgs(["check", "--no-push"])).toThrow(/does not belong to "opdk release check"/);
        expect(() => parseReleaseArgs(["check", "--zip"])).toThrow(/does not belong/);
    });

    it("needs a subcommand or a version", () => {
        expect(() => parseReleaseArgs([])).toThrow(/needs "check", patch, minor, major or a version/);
    });

    it("refuses a v prefix with the fix", () => {
        expect(() => parseReleaseArgs(["v1.2.3"])).toThrow('write 1.2.3 without the "v"');
    });

    it("refuses a pre-release and other text", () => {
        expect(() => parseReleaseArgs(["1.2.3-beta.1"])).toThrow(/Pre-release versions are not supported yet/);
        expect(() => parseReleaseArgs(["bogus"])).toThrow(/not patch, minor, major or an x\.y\.z version/);
    });

    it("refuses flags that belong to the other mode", () => {
        expect(() => parseReleaseArgs(["check", "--dry-run"])).toThrow(/belongs to "opdk release <version>"/);
        expect(() => parseReleaseArgs(["patch", "--tag", "1.0.0"])).toThrow(/belongs to "opdk release check"/);
    });

    it("refuses --tag without a value and unknown flags", () => {
        expect(() => parseReleaseArgs(["check", "--tag"])).toThrow(/needs the tag name/);
        expect(() => parseReleaseArgs(["check", "--tag", "--no-build"])).toThrow(/needs the tag name/);
        expect(() => parseReleaseArgs(["check", "--tag="])).toThrow(/needs the tag name/);
        expect(() => parseReleaseArgs(["check", "--force"])).toThrow('Unknown argument "--force"');
    });
});

describe("resolveVersion", () => {
    it("applies a bump to the current version or returns the exact one", () => {
        expect(resolveVersion({ kind: "bump", bump: "patch" }, "1.2.3")).toBe("1.2.4");
        expect(resolveVersion({ kind: "exact", version: "3.0.0" }, "1.2.3")).toBe("3.0.0");
    });
});

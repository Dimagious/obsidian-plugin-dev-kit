import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeKitVersion, readKitCommit, readKitVersion } from "./version.js";

describe("readKitVersion", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "opdk-version-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    const moduleUrl = (): string => pathToFileURL(path.join(dir, "dist", "cli", "version.js")).href;

    it("reads the version of the package two levels above the module, not cwd", () => {
        writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
        expect(readKitVersion(moduleUrl())).toBe("1.2.3");
    });

    it("reads the real package.json from the source tree", () => {
        expect(readKitVersion(import.meta.url)).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("fails clearly when package.json is missing", () => {
        expect(() => readKitVersion(moduleUrl())).toThrow("Cannot read the kit's package.json");
    });

    it("fails clearly when package.json has no version", () => {
        writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
        expect(() => readKitVersion(moduleUrl())).toThrow('has no string "version"');
    });

    it("fails clearly when the version is not a string", () => {
        writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: 1 }));
        expect(() => readKitVersion(moduleUrl())).toThrow('has no string "version"');
    });
});

describe("readKitCommit and describeKitVersion", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "opdk-version-"));
        mkdirSync(path.join(dir, "dist", "cli"), { recursive: true });
        writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    const moduleUrl = (): string => pathToFileURL(path.join(dir, "dist", "cli", "version.js")).href;
    const thrownBy = (run: () => unknown): Error => {
        try {
            run();
        } catch (error) {
            if (error instanceof Error) {
                return error;
            }
        }
        throw new Error("expected the call to throw an Error");
    };
    const writeInfo = (text: string): void => {
        writeFileSync(path.join(dir, "dist", "build-info.json"), text);
    };

    it("reads the commit from dist/build-info.json and appends it to the version", () => {
        writeInfo('{"commit":"3613c4f"}');
        expect(readKitCommit(moduleUrl())).toBe("3613c4f");
        expect(describeKitVersion(moduleUrl())).toBe("1.2.3 (3613c4f)");
    });

    it("prints just the version when the file is missing", () => {
        expect(readKitCommit(moduleUrl())).toBeUndefined();
        expect(describeKitVersion(moduleUrl())).toBe("1.2.3");
    });

    it("prints just the version when the build had no git commit", () => {
        writeInfo("{}");
        expect(describeKitVersion(moduleUrl())).toBe("1.2.3");
    });

    it("ignores an empty or non-string commit", () => {
        writeInfo('{"commit":""}');
        expect(readKitCommit(moduleUrl())).toBeUndefined();
        writeInfo('{"commit":7}');
        expect(readKitCommit(moduleUrl())).toBeUndefined();
    });

    it("fails clearly when the file is not valid JSON", () => {
        writeInfo("{bad");
        expect(() => readKitCommit(moduleUrl())).toThrow("is not valid JSON");
        expect(thrownBy(() => readKitCommit(moduleUrl())).cause).toBeInstanceOf(SyntaxError);
    });

    it("fails clearly when the file cannot be read for another reason than being absent", () => {
        mkdirSync(path.join(dir, "dist", "build-info.json"));
        expect(() => readKitCommit(moduleUrl())).toThrow("Cannot read the kit's build info");
        expect(thrownBy(() => readKitCommit(moduleUrl())).cause).toMatchObject({ code: "EISDIR" });
    });
});

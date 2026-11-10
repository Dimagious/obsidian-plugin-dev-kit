import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readKitVersion } from "./version.js";

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

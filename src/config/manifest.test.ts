import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readManifest } from "./manifest.js";

describe("readManifest", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "opdk-manifest-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    const write = (value: unknown): void => {
        writeFileSync(path.join(dir, "manifest.json"), typeof value === "string" ? value : JSON.stringify(value));
    };
    const base = { id: "snipsy", name: "Snipsy", version: "1.0.0" };

    it("reads the required fields", () => {
        write(base);
        expect(readManifest(dir)).toEqual(base);
    });

    it("keeps the optional fields and drops unrelated ones", () => {
        write({ ...base, minAppVersion: "1.5.0", isDesktopOnly: false, author: "me" });
        expect(readManifest(dir)).toEqual({ ...base, minAppVersion: "1.5.0", isDesktopOnly: false });
    });

    it("fails with guidance when manifest.json is missing", () => {
        expect(() => readManifest(dir)).toThrow(`No manifest.json in ${dir}. Run opdk from the plugin root.`);
    });

    it("fails with the file path on invalid JSON", () => {
        write("{ not json");
        expect(() => readManifest(dir)).toThrow(`${path.join(dir, "manifest.json")} is not valid JSON`);
    });

    it.each(["[]", "null", "7"])("rejects a non-object manifest %s", (text) => {
        write(text);
        expect(() => readManifest(dir)).toThrow("must contain a JSON object");
    });

    it.each(["id", "name", "version"])("rejects a missing %s", (key) => {
        write({ ...base, [key]: undefined });
        expect(() => readManifest(dir)).toThrow(`"${key}" is required`);
    });

    it("rejects an empty or non-string required field", () => {
        write({ ...base, id: "" });
        expect(() => readManifest(dir)).toThrow('"id" is required');
        write({ ...base, version: 1 });
        expect(() => readManifest(dir)).toThrow('"version" is required');
    });

    it("rejects optional fields of the wrong type", () => {
        write({ ...base, minAppVersion: 1 });
        expect(() => readManifest(dir)).toThrow('"minAppVersion" must be a string');
        write({ ...base, isDesktopOnly: "yes" });
        expect(() => readManifest(dir)).toThrow('"isDesktopOnly" must be a boolean');
    });
});

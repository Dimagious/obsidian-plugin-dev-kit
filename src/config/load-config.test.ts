import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, validateConfig } from "./load-config.js";

describe("loadConfig", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "opdk-config-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    const write = (source: string): void => {
        writeFileSync(path.join(dir, "opdk.config.mjs"), source);
    };

    it("returns an empty config when the file is missing", async () => {
        expect(await loadConfig(dir)).toEqual({});
    });

    it("loads the default export of the config file", async () => {
        write("export default {};\n");
        expect(await loadConfig(dir)).toEqual({});
    });

    it("loads and validates the build section", async () => {
        write('export default { build: { minify: false, loader: { ".png": "dataurl" } } };\n');
        expect(await loadConfig(dir)).toEqual({ build: { minify: false, loader: { ".png": "dataurl" } } });
    });

    it("loads the empty scan section", async () => {
        write("export default { scan: {} };\n");
        expect(await loadConfig(dir)).toEqual({ scan: {} });
    });

    it("loads and validates the release section", async () => {
        write('export default { release: { changelog: "HISTORY.md", defaultBranch: "master" } };\n');
        expect(await loadConfig(dir)).toEqual({ release: { changelog: "HISTORY.md", defaultBranch: "master" } });
    });

    it("names the config file and the key of an invalid release section", async () => {
        write('export default { release: { branch: "master" } };\n');
        await expect(loadConfig(dir)).rejects.toThrow(`${path.join(dir, "opdk.config.mjs")}: unknown key(s) in "release": branch.`);
    });

    it("loads build and scan together", async () => {
        write("export default { build: { minify: false }, scan: {} };\n");
        expect(await loadConfig(dir)).toEqual({ build: { minify: false }, scan: {} });
    });

    it("loads and validates the demo section", async () => {
        write('export default { demo: { output: "media", gif: { colors: 64 }, films: { tour: { layout: "phone-captions" } } } };\n');
        expect(await loadConfig(dir)).toEqual({ demo: { output: "media", gif: { colors: 64 }, films: { tour: { layout: "phone-captions" } } } });
    });

    it("names the config file and the key of an invalid demo section", async () => {
        write("export default { demo: { gif: { colors: 1 } } };\n");
        await expect(loadConfig(dir)).rejects.toThrow(`${path.join(dir, "opdk.config.mjs")}: "demo.gif.colors" must be a whole number from 2 to 256.`);
    });

    it("names the config file and the key of an invalid scan section", async () => {
        write('export default { scan: { ignore: ["site/**"] } };\n');
        await expect(loadConfig(dir)).rejects.toThrow(`${path.join(dir, "opdk.config.mjs")}: "scan.ignore" was removed.`);
    });

    it("names the config file and the key of an invalid build section", async () => {
        write('export default { build: { target: 5 } };\n');
        await expect(loadConfig(dir)).rejects.toThrow(`${path.join(dir, "opdk.config.mjs")}: "build.target" must be a non-empty string.`);
    });

    it("rejects unknown top-level keys and lists the allowed ones", async () => {
        write("export default { biuld: {} };\n");
        await expect(loadConfig(dir)).rejects.toThrow(/unknown top-level key\(s\): biuld\. Allowed keys: build, scan, demo, release\./);
    });

    it("names every unknown key", async () => {
        write("export default { a: 1, b: 2 };\n");
        await expect(loadConfig(dir)).rejects.toThrow("a, b");
    });

    it("rejects a file without a default export", async () => {
        write("export const x = 1;\n");
        await expect(loadConfig(dir)).rejects.toThrow("has no default export");
    });

    it.each(["[]", "null", "42", '"text"', "new Map()"])("rejects the non-plain default export %s", async (value) => {
        write(`export default ${value};\n`);
        await expect(loadConfig(dir)).rejects.toThrow("must export a plain object");
    });

    it("wraps a syntax error with the file path", async () => {
        write("export default {;\n");
        await expect(loadConfig(dir)).rejects.toThrow(`Cannot load ${path.join(dir, "opdk.config.mjs")}`);
    });

    it("treats a directory named opdk.config.mjs as no config", async () => {
        mkdirSync(path.join(dir, "opdk.config.mjs"));
        expect(await loadConfig(dir)).toEqual({});
    });
});

describe("validateConfig", () => {
    it("accepts an object with a null prototype", () => {
        expect(validateConfig(Object.create(null), "x")).toEqual({});
    });

    it("rejects an object with a custom prototype", () => {
        expect(() => validateConfig(Object.create({ inherited: 1 }), "x")).toThrow("must export a plain object");
    });
});

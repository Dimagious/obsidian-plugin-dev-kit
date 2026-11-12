import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVersionReader } from "./resolve.js";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-peers-"));
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function install(name: string, manifest: string): void {
    const dir = path.join(root, "node_modules", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), manifest);
}

describe("createVersionReader", () => {
    it("reads the version of a package installed in the folder", () => {
        install("fake-pkg", JSON.stringify({ name: "fake-pkg", version: "3.2.1" }));
        expect(createVersionReader(root)("fake-pkg")).toBe("3.2.1");
    });

    it("reads a scoped package", () => {
        install("@scope/fake", JSON.stringify({ name: "@scope/fake", version: "1.0.0" }));
        expect(createVersionReader(root)("@scope/fake")).toBe("1.0.0");
    });

    it("accepts a rootDir relative to the working directory", () => {
        install("fake-pkg", JSON.stringify({ version: "4.5.6" }));
        expect(createVersionReader(path.relative(process.cwd(), root))("fake-pkg")).toBe("4.5.6");
    });

    it("finds a package installed in a parent folder (hoisting)", () => {
        install("fake-pkg", JSON.stringify({ version: "2.0.0" }));
        const nested = path.join(root, "packages", "plugin");
        fs.mkdirSync(nested, { recursive: true });
        expect(createVersionReader(nested)("fake-pkg")).toBe("2.0.0");
    });

    it("returns undefined for a package that is not installed", () => {
        expect(createVersionReader(root)("opdk-no-such-package-xyz")).toBeUndefined();
    });

    it("throws, naming the package, when package.json has no version", () => {
        install("fake-pkg", JSON.stringify({ name: "fake-pkg" }));
        expect(() => createVersionReader(root)("fake-pkg")).toThrow('has no "version" field');
    });

    it("throws instead of reporting 'not installed' when the package does not export package.json", () => {
        install("closed-pkg", JSON.stringify({ name: "closed-pkg", version: "1.0.0", exports: { ".": "./index.js" } }));
        expect(() => createVersionReader(root)("closed-pkg")).toThrow('Cannot resolve "closed-pkg/package.json"');
    });

    it("throws on a package.json that is not JSON", () => {
        install("fake-pkg", "{");
        expect(() => createVersionReader(root)("fake-pkg")).toThrow();
    });
});

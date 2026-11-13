import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { testTmpRoot } from "../test-support/test-tmp.js";
import { assertElectronInstalled, createElectronProbe, type ElectronProbe } from "./electron-binary.js";

function probe(files: string[], resolved: string | Error): ElectronProbe {
    return {
        resolvePackageJson: () => {
            if (resolved instanceof Error) {
                throw resolved;
            }
            return resolved;
        },
        exists: (file) => files.includes(file),
    };
}

describe("assertElectronInstalled", () => {
    it("passes when path.txt sits next to the package", () => {
        const p = probe(["/plugin/node_modules/electron/path.txt"], "/plugin/node_modules/electron/package.json");
        expect(() => {
            assertElectronInstalled("/plugin", p);
        }).not.toThrow();
    });

    it("explains the first-use download when path.txt is missing", () => {
        const p = probe([], "/plugin/node_modules/electron/package.json");
        expect(() => {
            assertElectronInstalled("/plugin", p);
        }).toThrow(/downloads it on first use \(about 100 MB\).*node node_modules\/electron\/install\.js.*CI, cache/s);
    });

    it("says the plugin needs electron as a devDependency when it cannot be resolved", () => {
        const p = probe([], new Error("Cannot find module"));
        expect(() => {
            assertElectronInstalled("/plugin", p);
        }).toThrow(/needs "electron" as a devDependency/);
    });
});

describe("createElectronProbe", () => {
    let dir: string | undefined;
    afterEach(() => {
        if (dir !== undefined) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("resolves electron/package.json from the given folder and checks files on disk", () => {
        dir = fs.mkdtempSync(path.join(testTmpRoot(), "opdk-e2e-electron-"));
        const pkg = path.join(dir, "node_modules", "electron");
        fs.mkdirSync(pkg, { recursive: true });
        fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "electron", version: "0.0.0", main: "index.js" }));
        const real = createElectronProbe();
        const resolved = real.resolvePackageJson(dir);
        expect(fs.realpathSync(resolved)).toBe(fs.realpathSync(path.join(pkg, "package.json")));
        expect(real.exists(path.join(pkg, "path.txt"))).toBe(false);
        fs.writeFileSync(path.join(pkg, "path.txt"), "x");
        expect(real.exists(path.join(pkg, "path.txt"))).toBe(true);
    });

    it("throws when the folder has no electron", () => {
        const empty = fs.mkdtempSync(path.join(testTmpRoot(), "opdk-e2e-electron-"));
        dir = empty;
        expect(() => createElectronProbe().resolvePackageJson(empty)).toThrow();
    });
});

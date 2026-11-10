import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ElectronProbe } from "./electron-binary.js";
import globalSetup, { checkElectron } from "./global-setup.js";

describe("checkElectron", () => {
    const present: ElectronProbe = { resolvePackageJson: () => "/p/node_modules/electron/package.json", exists: () => true };

    it("passes when the binary is there", () => {
        expect(() => {
            checkElectron("/p", present);
        }).not.toThrow();
    });

    it("fails with the download hint when the binary is missing", () => {
        const missing: ElectronProbe = { ...present, exists: () => false };
        expect(() => {
            checkElectron("/p", missing);
        }).toThrow(/binary is not downloaded yet.*npx electron --version/s);
    });

    it("fails with the install hint when electron is not installed", () => {
        const none: ElectronProbe = {
            resolvePackageJson: () => {
                throw new Error("not found");
            },
            exists: () => false,
        };
        expect(() => {
            checkElectron("/p", none);
        }).toThrow('Cannot find the "electron" package from /p');
    });
});

describe("globalSetup against a real folder", () => {
    let dir: string;
    const cwd = process.cwd();

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-global-setup-test-"));
    });

    afterEach(() => {
        process.chdir(cwd);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("fails once, naming the plugin folder, in a folder without electron", () => {
        process.chdir(dir);
        expect(() => {
            globalSetup();
        }).toThrow(/Cannot find the "electron" package from .*opdk-global-setup-test-/);
    });

    it("fails until the folder's electron has path.txt, then passes", () => {
        const electron = path.join(dir, "node_modules", "electron");
        fs.mkdirSync(electron, { recursive: true });
        fs.writeFileSync(path.join(electron, "package.json"), '{"name":"electron","version":"0.0.0","main":"index.js"}');
        fs.writeFileSync(path.join(electron, "index.js"), "");
        process.chdir(dir);
        expect(() => {
            globalSetup();
        }).toThrow(/binary is not downloaded yet/);
        fs.writeFileSync(path.join(electron, "path.txt"), "electron");
        expect(() => {
            globalSetup();
        }).not.toThrow();
    });
});

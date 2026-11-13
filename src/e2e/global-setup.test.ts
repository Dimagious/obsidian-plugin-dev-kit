import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VersionReader } from "../peers/versions.js";
import type { ElectronProbe } from "./electron-binary.js";
import globalSetup, { checkElectron } from "./global-setup.js";

const supported: VersionReader = (name) => ({ "@playwright/test": "1.65.0", electron: "44.10.2" })[name];

describe("checkElectron", () => {
    const present: ElectronProbe = { resolvePackageJson: () => "/p/node_modules/electron/package.json", exists: () => true };

    it("passes when the binary is there", () => {
        expect(() => {
            checkElectron("/p", present, supported);
        }).not.toThrow();
    });

    it("fails with the download hint when the binary is missing", () => {
        const missing: ElectronProbe = { ...present, exists: () => false };
        expect(() => {
            checkElectron("/p", missing, supported);
        }).toThrow(/binary is not downloaded yet.*node [^"]*electron[\\/]install\.js/s);
    });

    it("fails with the install hint when electron is not installed", () => {
        const none: ElectronProbe = {
            resolvePackageJson: () => {
                throw new Error("not found");
            },
            exists: () => false,
        };
        expect(() => {
            checkElectron("/p", none, supported);
        }).toThrow('Cannot find the "electron" package from /p');
    });
});

describe("checkElectron versions", () => {
    const present: ElectronProbe = { resolvePackageJson: () => "/p/node_modules/electron/package.json", exists: () => true };

    it("fails on a Playwright older than the kit supports, with the install command", () => {
        const old: VersionReader = (name) => ({ "@playwright/test": "1.50.1", electron: "44.10.2" })[name];
        expect(() => {
            checkElectron("/p", present, old);
        }).toThrow(
            'obsidian-plugin-dev-kit/e2e: "@playwright/test" 1.50.1 is installed; the kit needs ^1.62.0.\nRun: npm install --save-dev @playwright/test@^1.62.0',
        );
    });

    it("fails on an Electron older than the kit supports", () => {
        const old: VersionReader = (name) => ({ "@playwright/test": "1.65.0", electron: "38.4.0" })[name];
        expect(() => {
            checkElectron("/p", present, old);
        }).toThrow('"electron" 38.4.0 is installed; the kit needs >=39.0.0.');
    });

    it("accepts a newer Electron than the one the kit was developed against", () => {
        const newer: VersionReader = (name) => ({ "@playwright/test": "1.65.0", electron: "60.0.0" })[name];
        expect(() => {
            checkElectron("/p", present, newer);
        }).not.toThrow();
    });

    it("reports both packages and one command when neither is installed", () => {
        expect(() => {
            checkElectron("/p", present, () => undefined);
        }).toThrow(/"@playwright\/test" is not installed[^]*"electron" is not installed[^]*Run: npm install --save-dev @playwright\/test@\^1\.62\.0 "electron@>=39\.0\.0"/);
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

    function installPackage(name: string, version: string): string {
        const folder = path.join(dir, "node_modules", name);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name, version, main: "index.js" }));
        fs.writeFileSync(path.join(folder, "index.js"), "");
        return folder;
    }

    it("fails once, naming both packages, in a folder with neither", () => {
        process.chdir(dir);
        expect(() => {
            globalSetup();
        }).toThrow(/"@playwright\/test" is not installed[^]*"electron" is not installed/);
    });

    it("fails in a folder with Playwright but without electron", () => {
        installPackage("@playwright/test", "1.65.0");
        process.chdir(dir);
        expect(() => {
            globalSetup();
        }).toThrow(/"electron" is not installed/);
    });

    it("fails until the folder's electron has path.txt, then passes", () => {
        installPackage("@playwright/test", "1.65.0");
        const electron = installPackage("electron", "44.10.2");
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

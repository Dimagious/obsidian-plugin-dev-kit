import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** What the check needs from the machine, injectable so tests need no real `node_modules`. */
export interface ElectronProbe {
    /** Absolute path of `electron/package.json` as the plugin at `cwd` resolves it; throws when it cannot. */
    resolvePackageJson(cwd: string): string;
    exists(file: string): boolean;
}

/** The real thing: Node's resolution from the plugin's folder, and the file system. */
export function createElectronProbe(): ElectronProbe {
    return {
        resolvePackageJson: (cwd) => createRequire(path.join(cwd, "noop.js")).resolve("electron/package.json"),
        exists: (file) => fs.existsSync(file),
    };
}

/**
 * Fails early when the plugin's `electron` has no binary yet. Electron 44 does not download it at install time: it
 * writes `path.txt` next to its `package.json` on first use, a download of about 100 MB. Without this check the
 * first `_electron.launch` would spend that time inside the launch timeout (45 s) and fail with a message that
 * does not mention the download.
 */
export function assertElectronInstalled(cwd: string, probe: ElectronProbe): void {
    let packageJson: string;
    try {
        packageJson = probe.resolvePackageJson(cwd);
    } catch (error) {
        throw new Error(
            `Cannot find the "electron" package from ${cwd}. The plugin needs "electron" as a devDependency to run e2e tests: npm install --save-dev electron.`,
            { cause: error },
        );
    }
    if (!probe.exists(path.join(path.dirname(packageJson), "path.txt"))) {
        throw new Error(
            `Electron is installed in ${path.dirname(packageJson)} but its binary is not downloaded yet. Electron downloads it on first use (about 100 MB), ` +
                `which would not fit in the launch timeout. Run "node node_modules/electron/install.js" once in ${cwd} and run the tests again. ` +
                `In CI, cache the Electron download (the ELECTRON_CACHE folder) and run that command in a step before the tests.`,
        );
    }
}

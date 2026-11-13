import { createVersionReader } from "../peers/resolve.js";
import type { VersionReader } from "../peers/versions.js";
import { assertElectronInstalled, createElectronProbe, type ElectronProbe } from "./electron-binary.js";
import { assertE2ePeers } from "./peers.js";

/**
 * Checks once, before any test starts, that the plugin's Playwright and Electron are versions the kit supports and
 * that its Electron has its binary. Playwright reports an error from a global setup once and runs nothing. The same
 * check in a fixture ran again for every test: a worker is replaced after each failed test, a worker fixture runs
 * again in the new worker, and a plugin with 59 tests got 59 identical failures (seen in a trial).
 */
export function checkElectron(
    cwd: string = process.cwd(),
    probe: ElectronProbe = createElectronProbe(),
    read: VersionReader = createVersionReader(cwd),
): void {
    assertE2ePeers(read, "obsidian-plugin-dev-kit/e2e");
    assertElectronInstalled(cwd, probe);
}

/** The entry Playwright calls: `defineObsidianConfig` registers this file as a `globalSetup`. */
export default function globalSetup(): void {
    checkElectron();
}

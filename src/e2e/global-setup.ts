import { assertElectronInstalled, createElectronProbe, type ElectronProbe } from "./electron-binary.js";

/**
 * Checks once, before any test starts, that the plugin's Electron has its binary. Playwright reports an error from a
 * global setup once and runs nothing. The same check in a fixture ran again for every test: a worker is replaced
 * after each failed test, a worker fixture runs again in the new worker, and a plugin with 59 tests got 59
 * identical failures (Dashy trial).
 */
export function checkElectron(cwd: string = process.cwd(), probe: ElectronProbe = createElectronProbe()): void {
    assertElectronInstalled(cwd, probe);
}

/** The entry Playwright calls: `defineObsidianConfig` registers this file as a `globalSetup`. */
export default function globalSetup(): void {
    checkElectron();
}

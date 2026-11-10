import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

/**
 * The kit's global setup next to this file, with this file's own extension: `.js` from the installed `dist/`, `.ts`
 * when the kit's own smoke config loads the sources.
 */
const GLOBAL_SETUP = fileURLToPath(new URL(`./global-setup${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url));

function toList(value: string | string[] | undefined): string[] {
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/**
 * The Playwright settings every Obsidian plugin's e2e shares. Obsidian opens one window per process and the specs
 * share nothing, so they run one at a time; a cold start can take 15 to 20 seconds on a busy machine, hence the
 * long test timeout.
 */
export function buildObsidianConfig(
    overrides: PlaywrightTestConfig = {},
    env: Readonly<Record<string, string | undefined>> = process.env,
): PlaywrightTestConfig {
    const ci = env.CI !== undefined && env.CI !== "" && env.CI !== "0" && env.CI !== "false";
    return {
        testDir: "e2e",
        fullyParallel: false,
        workers: 1,
        forbidOnly: ci,
        retries: ci ? 1 : 0,
        reporter: ci ? "list" : [["list"], ["html", { open: "never" }]],
        timeout: 60_000,
        ...overrides,
        // The kit's check runs first; a `globalSetup` of the plugin runs after it, so a missing Electron is the only error.
        globalSetup: [GLOBAL_SETUP, ...toList(overrides.globalSetup)],
        expect: { timeout: 10_000, ...overrides.expect },
        use: {
            trace: "retain-on-failure",
            video: "retain-on-failure",
            screenshot: "only-on-failure",
            ...overrides.use,
        },
    };
}

/** `playwright.config.ts` for a plugin: `export default defineObsidianConfig()`. Pass overrides for anything plugin-specific. */
export function defineObsidianConfig(overrides: PlaywrightTestConfig = {}): PlaywrightTestConfig {
    return defineConfig(buildObsidianConfig(overrides));
}

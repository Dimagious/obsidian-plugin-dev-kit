import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

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

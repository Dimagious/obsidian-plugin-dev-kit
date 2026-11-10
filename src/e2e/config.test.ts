import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildObsidianConfig, defineObsidianConfig } from "./config.js";

describe("buildObsidianConfig", () => {
    it("serial runs, long timeouts, artefacts on failure, e2e folder", () => {
        const config = buildObsidianConfig({}, {});
        expect(config).toMatchObject({
            testDir: "e2e",
            fullyParallel: false,
            workers: 1,
            timeout: 60_000,
            expect: { timeout: 10_000 },
            use: { trace: "retain-on-failure", video: "retain-on-failure", screenshot: "only-on-failure" },
            forbidOnly: false,
            retries: 0,
        });
        expect(config.reporter).toEqual([["list"], ["html", { open: "never" }]]);
    });

    it("retries once and forbids .only on CI", () => {
        const config = buildObsidianConfig({}, { CI: "true" });
        expect(config).toMatchObject({ retries: 1, forbidOnly: true, reporter: "list" });
    });

    it.each(["", "0", "false"])("does not treat CI=%j as CI", (value) => {
        expect(buildObsidianConfig({}, { CI: value }).retries).toBe(0);
    });

    it("lets the plugin override a setting", () => {
        expect(buildObsidianConfig({ testDir: "tests/e2e", timeout: 90_000 }, {})).toMatchObject({
            testDir: "tests/e2e",
            timeout: 90_000,
        });
    });

    it("merges expect and use instead of replacing them", () => {
        const config = buildObsidianConfig({ expect: { timeout: 20_000 }, use: { screenshot: "on" } }, {});
        expect(config.expect).toEqual({ timeout: 20_000 });
        expect(config.use).toEqual({ trace: "retain-on-failure", video: "retain-on-failure", screenshot: "on" });
        expect(buildObsidianConfig({ use: { baseURL: "http://x" } }, {}).use).toMatchObject({
            baseURL: "http://x",
            trace: "retain-on-failure",
        });
    });
});

describe("buildObsidianConfig: global setup", () => {
    function kitSetup(config: ReturnType<typeof buildObsidianConfig>): string {
        const first = Array.isArray(config.globalSetup) ? config.globalSetup[0] : config.globalSetup;
        expect(first).toBeDefined();
        return first ?? "";
    }

    it("registers the kit's Electron check, an absolute path to global-setup next to the config", () => {
        const file = kitSetup(buildObsidianConfig({}, {}));
        expect(path.isAbsolute(file)).toBe(true);
        expect(path.basename(file, path.extname(file))).toBe("global-setup");
    });

    it("runs the plugin's own global setup after it, string or list", () => {
        expect(buildObsidianConfig({ globalSetup: "./leftovers.ts" }, {}).globalSetup).toEqual([kitSetup(buildObsidianConfig({}, {})), "./leftovers.ts"]);
        expect(buildObsidianConfig({ globalSetup: ["./a.ts", "./b.ts"] }, {}).globalSetup).toEqual([
            kitSetup(buildObsidianConfig({}, {})),
            "./a.ts",
            "./b.ts",
        ]);
    });
});

describe("defineObsidianConfig", () => {
    it("returns the preset with the overrides applied", () => {
        expect(defineObsidianConfig({ testDir: "specs" })).toMatchObject({ testDir: "specs", workers: 1 });
    });
});

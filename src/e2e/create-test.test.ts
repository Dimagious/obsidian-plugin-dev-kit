import fs from "node:fs";
import path from "node:path";
import { test as base } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createObsidianTest } from "./create-test.js";
import { createFakeDemoWindow } from "../test-support/demo-fakes.js";
import { createFakeHelperWindow } from "../test-support/e2e-fakes.js";
import { testTmpRoot } from "../test-support/test-tmp.js";
import { parseFilmManifest } from "./demo/manifest.js";
import type { DemoHelpers } from "./demo/types.js";
import { editorTextChanged, isEditorSettled, isFocusInside, readEditorText } from "./helpers/page-scripts.js";
import { sessionFixtureTimeout } from "./fixtures.js";
import type { ObsidianHelpers } from "./helpers/types.js";

type FixtureFn = (args: unknown, use: (value: unknown) => Promise<void>, testInfo?: unknown) => Promise<void>;

/** Runs `body` with the internal helper-kit fixture of a test, then lets the fixture tear down (which detaches the CDP session). */
async function withHelperKit(fixtures: Record<string, unknown>, win: unknown, body: (kit: unknown) => Promise<void>): Promise<void> {
    const [make] = fixtures.opdkHelpers as [FixtureFn, unknown];
    await make({ win }, body);
}

describe("createObsidianTest", () => {
    it("returns test, expect and onlyWhen", () => {
        const kit = createObsidianTest({ seedVault: "e2e/vault" });
        expect(typeof kit.test).toBe("function");
        expect(typeof kit.test.extend).toBe("function");
        expect(typeof kit.expect).toBe("function");
        expect(typeof kit.onlyWhen).toBe("function");
    });

    it("rejects bad options when it is called, naming the key", () => {
        expect(() => createObsidianTest({ seedVault: "" })).toThrow('"seedVault" is required');
        expect(() => createObsidianTest({ seedVault: "v", plugins: [] })).toThrow('"plugins" must be a non-empty array');
        expect(() => createObsidianTest(undefined as never)).toThrow("options must be an object");
    });

    it("onlyWhen skips the file unless the variable is 1", () => {
        const kit = createObsidianTest({ seedVault: "v" });
        const skip = vi.spyOn(kit.test, "skip").mockImplementation(() => undefined);
        vi.stubEnv("OPDK_TEST_GATE", "");
        kit.onlyWhen("OPDK_TEST_GATE");
        expect(skip).toHaveBeenLastCalledWith(true, "set OPDK_TEST_GATE=1 to run this spec");
        vi.stubEnv("OPDK_TEST_GATE", "1");
        kit.onlyWhen("OPDK_TEST_GATE");
        expect(skip).toHaveBeenLastCalledWith(false, "set OPDK_TEST_GATE=1 to run this spec");
        vi.unstubAllEnvs();
    });

    it("registers the session fixture with its own timeout and hides the internal fixtures from reports", () => {
        const extend = vi.spyOn(base, "extend");
        createObsidianTest({ seedVault: "v", timeouts: { launch: 10_000, ready: 10_000, close: 1_000 } });
        const fixtures = extend.mock.calls[0]?.[0] as Record<string, unknown>;
        extend.mockRestore();
        expect(fixtures.opdkSession).toEqual([
            expect.any(Function),
            { box: true, timeout: sessionFixtureTimeout({ launch: 10_000, ready: 10_000, close: 1_000, trace: 60_000 }) },
        ]);
        expect(fixtures.opdkSweep).toEqual([expect.any(Function), { scope: "worker", auto: true, box: true }]);
        expect(typeof fixtures.win).toBe("function");
    });

    it("gives every fixture function an object destructuring pattern as first parameter, which Playwright requires", () => {
        const extend = vi.spyOn(base, "extend");
        createObsidianTest({ seedVault: "v" });
        const fixtures = extend.mock.calls[0]?.[0] as Record<string, unknown>;
        extend.mockRestore();
        const functions = Object.values(fixtures).map((value) => (Array.isArray(value) ? (value[0] as unknown) : value));
        expect(functions).toHaveLength(8);
        for (const fn of functions) {
            expect(String(fn)).toMatch(/^(async\s*)?(function\s*\w*\s*)?\(\s*\{/);
        }
    });

    it("the session fixture reads Playwright's trace and video option fixtures, so test.use({ trace, video }) counts", async () => {
        const extend = vi.spyOn(base, "extend");
        createObsidianTest({ seedVault: "v" });
        const fixtures = extend.mock.calls[0]?.[0] as Record<string, unknown>;
        extend.mockRestore();
        const [session] = fixtures.opdkSession as [(args: unknown, use: () => Promise<void>, testInfo: unknown) => Promise<void>];
        // A bad value is rejected while the settings are read, before anything starts: proof that the wrapper passed it on.
        const testInfo = { title: "t", annotations: [], attachments: [], retry: 0, expectedStatus: "passed", outputPath: () => "" };
        await expect(session({ trace: "bogus", video: "off" }, () => Promise.resolve(), testInfo)).rejects.toThrow("use.trace");
        await expect(session({ trace: "off", video: "bogus" }, () => Promise.resolve(), testInfo)).rejects.toThrow("use.video");
    });

    it("obsidian offers every helper, bound to the fixture window", async () => {
        const extend = vi.spyOn(base, "extend");
        createObsidianTest({ seedVault: "v", timeouts: { launch: 10_000, ready: 12_345, close: 1_000 } });
        const fixtures = extend.mock.calls[0]?.[0] as Record<string, (args: unknown, use: (value: unknown) => Promise<void>) => Promise<void>>;
        extend.mockRestore();
        const fake = createFakeHelperWindow();
        let helpers: ObsidianHelpers | undefined;
        await withHelperKit(fixtures, fake.win, async (opdkHelpers) => {
            await fixtures.obsidian?.({ opdkHelpers }, (value) => {
                helpers = value as ObsidianHelpers;
                return Promise.resolve();
            });
        });
        expect(Object.keys(helpers ?? {}).sort()).toEqual(
            [
                "clearNotices", "closeSettings", "collapseSidebars", "desktop", "editor", "evaluate", "expandSidebars", "hideProperties", "mobile", "openCommandPalette", "openFile",
                "openSettings", "press", "readingView", "reload", "replace", "runCommand", "runCommandFromPalette", "scrollThrough", "setTheme",
                "settle", "waitForMetadataCache",
            ].sort(),
        );
        // The helpers are bound to the fixture's window.
        await helpers?.press("Escape");
        expect(fake.log).toEqual(["press:Escape"]);
    });

    it("takes the helper budgets from the options and detaches what the helpers opened once the test is over", async () => {
        const extend = vi.spyOn(base, "extend");
        createObsidianTest({ seedVault: "v", timeouts: { helpers: { ui: 777 } } });
        const fixtures = extend.mock.calls[0]?.[0] as Record<string, (args: unknown, use: (value: unknown) => Promise<void>) => Promise<void>>;
        extend.mockRestore();
        const fake = createFakeHelperWindow();
        fake.onEvaluate(isFocusInside, () => true);
        fake.onEvaluate(readEditorText, () => "");
        fake.onWait(isEditorSettled, () => undefined);
        fake.onWait(editorTextChanged, () => undefined);
        let detachedDuringTest: boolean | undefined;
        await withHelperKit(fixtures, fake.win, async (opdkHelpers) => {
            await fixtures.obsidian?.({ opdkHelpers }, async (value) => {
                const helpers = value as ObsidianHelpers;
                await helpers.openCommandPalette();
                await helpers.editor().compose("a");
                detachedDuringTest = fake.log.includes("cdp.detach");
            });
        });
        expect(fake.timeouts).toContainEqual({ what: "waitFor:.prompt-input", timeout: 777 });
        expect(fake.log).toContain("newCDPSession");
        expect(detachedDuringTest).toBe(false);
        expect(fake.log.at(-1)).toBe("cdp.detach");
        expect(fake.unbounded).toEqual([]);
    });

    it("win, app and vault are views of the one session", async () => {
        const extend = vi.spyOn(base, "extend");
        createObsidianTest({ seedVault: "v" });
        const fixtures = extend.mock.calls[0]?.[0] as Record<string, (args: unknown, use: (value: unknown) => Promise<void>) => Promise<void>>;
        extend.mockRestore();
        const session = { win: "W", app: "A", vault: "V" };
        const seen: unknown[] = [];
        for (const name of ["win", "app", "vault"]) {
            await fixtures[name]?.({ opdkSession: session }, (value) => {
                seen.push(value);
                return Promise.resolve();
            });
        }
        expect(seen).toEqual(["W", "A", "V"]);
    });

    it("the helper kit is one fixture, hidden from reports, that obsidian and demo share", () => {
        const extend = vi.spyOn(base, "extend");
        createObsidianTest({ seedVault: "v" });
        const fixtures = extend.mock.calls[0]?.[0] as Record<string, unknown>;
        extend.mockRestore();
        expect(fixtures.opdkHelpers).toEqual([expect.any(Function), { box: true }]);
        expect(typeof fixtures.demo).toBe("function");
    });

    describe("the demo fixture", () => {
        let outDir: string;
        beforeEach(() => {
            outDir = fs.mkdtempSync(path.join(testTmpRoot(), "opdk-e2e-demo-fixture-"));
        });
        afterEach(() => {
            fs.rmSync(outDir, { recursive: true, force: true });
        });

        function fixturesFor(options: object = {}): Record<string, FixtureFn> {
            const extend = vi.spyOn(base, "extend");
            createObsidianTest({ seedVault: "v", demo: { outDir }, ...options });
            const fixtures = extend.mock.calls[0]?.[0] as Record<string, FixtureFn>;
            extend.mockRestore();
            return fixtures;
        }

        /** What the demo fixture reads from `testInfo`. */
        function infoOf(overrides: object = {}): object {
            return {
                title: "My Tour",
                titlePath: ["e2e/tour.spec.ts", "Phone", "My Tour"],
                testId: "id-1",
                file: path.join(process.cwd(), "e2e", "tour.spec.ts"),
                project: { name: "obsidian" },
                config: { projects: [{}] },
                status: "passed",
                expectedStatus: "passed",
                ...overrides,
            };
        }

        it("shoots through the CDP session that obsidian shares, names films after the test, and completes them when the test passed", async () => {
            const fixtures = fixturesFor();
            const fake = createFakeDemoWindow();
            await withHelperKit(fixtures, fake.win, async (opdkHelpers) => {
                await fixtures.demo?.({ win: fake.win, opdkHelpers }, async (value) => {
                    const demo = value as DemoHelpers;
                    const film = demo.film({ kind: "desktop" });
                    await film.shot({ hold: 1 });
                    await demo.still("hero");
                }, infoOf());
            });
            expect(fake.log.filter((entry) => entry === "newCDPSession")).toHaveLength(1);
            expect(fake.cdp.map((command) => command.method)).toEqual([
                "Emulation.setDeviceMetricsOverride",
                "Page.captureScreenshot",
                "Page.captureScreenshot",
            ]);
            expect(parseFilmManifest(fs.readFileSync(path.join(outDir, "films", "phone-my-tour", "manifest.json"), "utf8"))).toMatchObject({
                complete: true,
                source: { testId: "id-1", title: "Phone My Tour", file: "e2e/tour.spec.ts" },
            });
            expect(fs.existsSync(path.join(outDir, "stills", "hero.png"))).toBe(true);
            expect(fake.log.at(-1)).toBe("cdp.detach");
        });

        it("leaves the film incomplete when the test failed", async () => {
            const fixtures = fixturesFor();
            const fake = createFakeDemoWindow();
            await withHelperKit(fixtures, fake.win, async (opdkHelpers) => {
                await fixtures.demo?.({ win: fake.win, opdkHelpers }, async (value) => {
                    await (value as DemoHelpers).film({ kind: "desktop" }).shot({ hold: 1 });
                }, infoOf({ title: "Broken", titlePath: ["e2e/tour.spec.ts", "Broken"], status: "failed" }));
            });
            expect(parseFilmManifest(fs.readFileSync(path.join(outDir, "films", "broken", "manifest.json"), "utf8"))).toMatchObject({ complete: false });
        });

        it("leaves the film incomplete for a test.fail() test that failed as expected", async () => {
            const fixtures = fixturesFor();
            const fake = createFakeDemoWindow();
            await withHelperKit(fixtures, fake.win, async (opdkHelpers) => {
                await fixtures.demo?.({ win: fake.win, opdkHelpers }, async (value) => {
                    await (value as DemoHelpers).film({ kind: "desktop" }).shot({ hold: 1 });
                }, infoOf({ titlePath: ["e2e/tour.spec.ts", "Expected"], status: "failed", expectedStatus: "failed" }));
            });
            expect(parseFilmManifest(fs.readFileSync(path.join(outDir, "films", "expected", "manifest.json"), "utf8"))).toMatchObject({ complete: false });
        });

        it("adds the project name to the default film name when the config has several projects", async () => {
            const fixtures = fixturesFor();
            const fake = createFakeDemoWindow();
            await withHelperKit(fixtures, fake.win, async (opdkHelpers) => {
                await fixtures.demo?.({ win: fake.win, opdkHelpers }, (value) => {
                    expect((value as DemoHelpers).film({ kind: "desktop" }).name).toBe("phone-my-tour-narrow");
                    return Promise.resolve();
                }, infoOf({ project: { name: "narrow" }, config: { projects: [{}, {}] } }));
            });
        });

        it("refuses capture when OPDK_E2E_VAULT chose the vault, and takes the selectors and scale of the options", async () => {
            vi.stubEnv("OPDK_E2E_VAULT", "/somewhere/real-vault");
            const fixtures = fixturesFor({ demo: { outDir, scale: 1, forbiddenSelectors: [".secret"] } });
            vi.unstubAllEnvs();
            const fake = createFakeDemoWindow();
            await withHelperKit(fixtures, fake.win, async (opdkHelpers) => {
                await fixtures.demo?.({ win: fake.win, opdkHelpers }, (value) => {
                    const demo = value as DemoHelpers;
                    expect(() => demo.film({ kind: "desktop" })).toThrow(/OPDK_E2E_VAULT points this run at \/somewhere\/real-vault/);
                    return Promise.resolve();
                }, infoOf());
            });
        });
    });
});

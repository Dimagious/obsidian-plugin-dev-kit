import { test as base } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { createObsidianTest } from "./create-test.js";
import { createFakeHelperWindow } from "../test-support/e2e-fakes.js";
import { editorTextChanged, isEditorSettled, isFocusInside, readEditorText } from "./helpers/page-scripts.js";
import { sessionFixtureTimeout } from "./fixtures.js";
import type { ObsidianHelpers } from "./helpers/types.js";

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
        expect(functions).toHaveLength(6);
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
        await fixtures.obsidian?.({ win: fake.win }, (value) => {
            helpers = value as ObsidianHelpers;
            return Promise.resolve();
        });
        expect(Object.keys(helpers ?? {}).sort()).toEqual(
            [
                "clearNotices", "closeSettings", "desktop", "editor", "evaluate", "hideProperties", "mobile", "openCommandPalette", "openFile",
                "openSettings", "press", "readingView", "replace", "runCommand", "runCommandFromPalette", "scrollThrough", "setTheme",
                "waitForMetadataCache",
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
        await fixtures.obsidian?.({ win: fake.win }, async (value) => {
            const helpers = value as ObsidianHelpers;
            await helpers.openCommandPalette();
            await helpers.editor().compose("a");
            detachedDuringTest = fake.log.includes("cdp.detach");
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
});

import { test as base } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { createObsidianTest } from "./create-test.js";
import { sessionFixtureTimeout } from "./fixtures.js";

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
            { box: true, timeout: sessionFixtureTimeout({ launch: 10_000, ready: 10_000, close: 1_000 }) },
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
        expect(functions).toHaveLength(5);
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

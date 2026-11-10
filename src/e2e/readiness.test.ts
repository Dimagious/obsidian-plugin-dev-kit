import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { createFakeObsidian } from "../test-support/e2e-fakes.js";
import { formatReadinessFailure, TRUST_BUTTON_NAME, waitForReady } from "./readiness.js";

const failure = {
    timeoutMs: 30_000,
    hasApp: true,
    layoutReady: true,
    missing: [] as string[],
    loading: [] as string[],
    trustDialogVisible: false,
};

describe("formatReadinessFailure", () => {
    it("names every plugin that did not load", () => {
        const message = formatReadinessFailure({ ...failure, missing: ["garmidian", "dashsidian"] });
        expect(message).toContain("after 30000 ms");
        expect(message).toContain("plugins not loaded: garmidian, dashsidian");
        expect(message).toContain("developer console");
    });

    it("uses the singular for one plugin", () => {
        expect(formatReadinessFailure({ ...failure, missing: ["a"] })).toContain("plugin not loaded: a");
    });

    it("names a plugin whose onload() is still running", () => {
        const message = formatReadinessFailure({ ...failure, loading: ["garmidian"] });
        expect(message).toContain("plugin still loading: garmidian.");
        expect(message).not.toContain("not loaded");
        expect(message).toContain("hanging onload()");
    });

    it("lists loading and not-yet-started plugins separately", () => {
        const message = formatReadinessFailure({ ...failure, loading: ["a", "b"], missing: ["c"] });
        expect(message).toContain("plugins still loading: a, b; plugin not loaded: c.");
    });

    it("says the layout was not ready", () => {
        const message = formatReadinessFailure({ ...failure, layoutReady: false });
        expect(message).toContain("the workspace layout was not ready");
        expect(message).not.toContain("not loaded");
    });

    it("reports both problems together", () => {
        const message = formatReadinessFailure({ ...failure, layoutReady: false, missing: ["a"] });
        expect(message).toContain("the workspace layout was not ready; plugin not loaded: a.");
    });

    it("fails loudly on the trust dialog and says the kit did not click it", () => {
        const message = formatReadinessFailure({ ...failure, missing: ["a"], trustDialogVisible: true });
        expect(message).toContain(`"${TRUST_BUTTON_NAME}" dialog is open`);
        expect(message).toContain("does not click the dialog");
    });

    it("explains a missing app object", () => {
        expect(formatReadinessFailure({ ...failure, hasApp: false, layoutReady: false })).toContain("vault did not open");
    });

    it("passes on the reason when the diagnostics themselves failed", () => {
        expect(formatReadinessFailure({ ...failure, diagnosticsError: "Target closed" })).toContain("Could not tell why: Target closed");
    });

    it("suggests a longer timeout when the state looks ready after all", () => {
        expect(formatReadinessFailure(failure)).toContain("raise timeouts.ready");
    });
});

describe("waitForReady", () => {
    it("polls every 50 ms with the plugin ids and the timeout", async () => {
        const fake = createFakeObsidian();
        await waitForReady(fake.page, ["a", "b"], 1234);
        expect(fake.calls).toEqual(['waitForFunction:["a","b"]:{"polling":50,"timeout":1234}']);
    });

    it("fails with the missing plugin named and keeps the Playwright error as the cause", async () => {
        const fake = createFakeObsidian({ notReady: { missing: ["garmidian"] } });
        const error = await waitForReady(fake.page, ["garmidian"], 100).then(
            () => undefined,
            (caught: unknown) => caught,
        );
        expect((error as Error).message).toContain("plugin not loaded: garmidian");
        expect(((error as Error).cause as Error).message).toContain("Timeout");
    });

    it("fails naming a plugin that is still loading", async () => {
        const fake = createFakeObsidian({ notReady: { missing: [], loading: ["slow"] } });
        await expect(waitForReady(fake.page, ["slow"], 100)).rejects.toThrow("plugin still loading: slow");
    });

    it("fails naming the trust dialog when it is visible", async () => {
        const fake = createFakeObsidian({ notReady: { missing: ["a"], trustDialogVisible: true } });
        await expect(waitForReady(fake.page, ["a"], 100)).rejects.toThrow(/dialog is open/);
    });

    it("reports a diagnostics failure instead of hiding it", async () => {
        const page = {
            waitForFunction: () => Promise.reject(new Error("Timeout")),
            evaluate: () => Promise.reject(new Error("Target page, context or browser has been closed")),
        };
        await expect(waitForReady(page as unknown as Page, ["a"], 100)).rejects.toThrow(
            "Could not tell why: Target page, context or browser has been closed",
        );
    });
});

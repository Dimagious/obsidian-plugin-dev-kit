/**
 * Fails on purpose so that the failure artifacts can be checked by eye. Skipped unless `OPDK_E2E_FORCE_FAIL=1`;
 * see the README next to `e2e/`.
 */
import { expect, onlyWhen, test } from "./fixtures.js";

// At file level, so a skipped run never starts Obsidian.
onlyWhen("OPDK_E2E_FORCE_FAIL");

test("artifacts: a forced failure leaves a trace and a video", async ({ win }) => {
    // Some actions for the trace to show, then the failure.
    await win.waitForTimeout(500);
    await win.locator("body").click();
    expect(await win.title(), "deliberate failure to produce artifacts").toBe("not the title");
});

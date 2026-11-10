/**
 * The take behind docs/media/e2e.gif: a short, readable run of the kit driving a real Obsidian. Skipped unless
 * `OPDK_E2E_MEDIA=1`; `npm run docs:media:e2e` runs it and turns the recording into the GIF.
 *
 * The pauses are for the viewer of the recording, not waits for a condition: every step already waits for its own
 * state. They are the only fixed delays in the kit's specs.
 */
import path from "node:path";
import { createObsidianTest } from "../../../src/e2e/index.js";
import { FIXTURE_ID, SECOND_ID, SEED_VAULT } from "./fixtures.js";

const root = path.join(import.meta.dirname, "..");
const VIDEO = { width: 1024, height: 640 };

// Its own fixture: a window the size of the recording, so the text in the GIF stays readable.
const { test, expect, onlyWhen } = createObsidianTest({
    seedVault: SEED_VAULT,
    plugins: [{ dir: path.join(root, "plugins", FIXTURE_ID) }, { dir: path.join(root, "plugins", SECOND_ID) }],
    window: VIDEO,
});

// At file level, so a skipped run never starts Obsidian.
onlyWhen("OPDK_E2E_MEDIA");

test.use({ video: { mode: "on", size: VIDEO } });

const PAUSE_MS = 900;

test("media: open a note, type, run a command from the palette, open the plugin settings", async ({ obsidian, win }) => {
    await obsidian.openFile("Welcome.md", { mode: "source" });
    await win.waitForTimeout(PAUSE_MS);

    await obsidian.editor().clear();
    await obsidian.editor().type("# Typed by the kit\n\nKey by key, in a real editor.");
    await win.waitForTimeout(PAUSE_MS);

    // The palette by hand, slowly: `runCommandFromPalette()` is too quick to be seen in a recording.
    const palette = await obsidian.openCommandPalette();
    await palette.pressSequentially("Show notice", { delay: 70 });
    await win.waitForTimeout(PAUSE_MS);
    await obsidian.press("Enter");
    await expect(win.locator(".notice", { hasText: "opdk notice" })).toBeVisible();
    await win.waitForTimeout(PAUSE_MS);
    await obsidian.clearNotices();

    const settings = await obsidian.openSettings(FIXTURE_ID);
    await expect(settings.getByText("OPDK E2E Fixture")).toBeVisible();
    await win.waitForTimeout(PAUSE_MS);
});

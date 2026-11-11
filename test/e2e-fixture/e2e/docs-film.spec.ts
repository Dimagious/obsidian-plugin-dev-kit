/**
 * The film behind docs/media/demo.gif, recorded with the kit's own `demo` fixture on the fixture plugins and the
 * seed vault: a phone film of four steps, captions beside the phone. Skipped unless `OPDK_E2E_DOCS_FILM=1`;
 * `npm run docs:media:demo` runs it and then `opdk demo` (settings in the repository's `opdk.config.mjs`).
 *
 * A film of stills takes its timing from `hold`, not from the machine, so there are no pauses here. The film ends
 * where it began (same note, same text, same step), so the GIF loops without a jump.
 */
import path from "node:path";
import { createObsidianTest } from "../../../src/e2e/index.js";
import { FIXTURE_ID, SECOND_ID, SEED_VAULT } from "./fixtures.js";

const root = path.join(import.meta.dirname, "..");
const EDITOR = '.workspace-leaf-content[data-type="markdown"] .cm-content[contenteditable=true]';

const { test, expect, onlyWhen } = createObsidianTest({
    seedVault: SEED_VAULT,
    plugins: [{ dir: path.join(root, "plugins", FIXTURE_ID) }, { dir: path.join(root, "plugins", SECOND_ID) }],
    // The film is named in `opdk.config.mjs`, so the output folder is the default one.
    demo: { outDir: ".opdk/demo" },
});

onlyWhen("OPDK_E2E_DOCS_FILM");

test("demo: open a note, type, run a command, open the plugin's settings", async ({ obsidian, demo, win }) => {
    // A fixed date, so nothing in the frames depends on the day the film is shot.
    await demo.freezeTime("2026-03-14T09:26:00");
    await obsidian.mobile();
    await obsidian.openFile("Welcome.md", { mode: "source" });
    await demo.cleanUi();
    await obsidian.clearNotices();
    const original = await obsidian.editor().text();
    const editor = win.locator(EDITOR).first();
    // The film starts in the state it ends in: the editor focused, so the toolbar is there in the first frame too.
    await demo.tap(editor);
    await demo.hideCursor();

    const film = demo.film({
        name: "demo",
        kind: "phone",
        captions: ["Open a note\nIn a copy of the seed vault", "Type\nKey by key, at a pace you can read", "Run a command\nFrom the command palette", "Open the settings\nOf the plugin you are filming"],
    });
    await film.shot({ hold: 1.8, caption: 0 });

    await demo.typeSlowly("\n# Typed", { delayMs: 45 });
    await film.shot({ hold: 0.5, caption: 1 });
    await demo.typeSlowly(" by the kit\n\nKey by key", { delayMs: 45 });
    await film.shot({ hold: 0.5, caption: 1 });
    await demo.typeSlowly(", in a real editor.", { delayMs: 45 });
    await expect(editor).toContainText("in a real editor.");
    await film.shot({ hold: 1.6, caption: 1 });

    // The palette input has the focus when it opens, so no cursor crosses the phone.
    await obsidian.openCommandPalette();
    await demo.typeSlowly("Show notice", { delayMs: 45 });
    await expect(win.locator(".prompt-results .suggestion-item.is-selected", { hasText: "Show notice" }).first()).toBeVisible();
    await film.shot({ hold: 1.4, caption: 2 });
    await obsidian.press("Enter");
    await expect(win.locator(".notice", { hasText: "opdk notice" })).toBeVisible();
    await film.shot({ hold: 1.6, caption: 2 });
    await obsidian.clearNotices();
    await demo.hideCursor();

    const settings = await obsidian.openSettings(FIXTURE_ID);
    await expect(settings.getByText("OPDK E2E Fixture")).toBeVisible();
    await film.shot({ hold: 1.8, caption: 3 });

    // Back to the first frame, so the loop has no jump.
    await obsidian.closeSettings();
    await obsidian.editor().clear();
    await obsidian.editor().type(original);
    await demo.tap(editor);
    await expect(editor).toContainText("A note in the kit's e2e seed vault.");
    await demo.hideCursor();
    await film.shot({ hold: 0.6, caption: 0 });
});

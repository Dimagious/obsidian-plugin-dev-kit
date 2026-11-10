/**
 * The live checklist of the `obsidian` helpers (src/e2e/helpers). Every helper runs against the real Obsidian and the
 * two fixture plugins; the assertions read Obsidian's own state wherever there is some. Every test gets its own
 * Obsidian and vault copy, so nothing a test changes outlives it.
 */
import type { Page } from "@playwright/test";
import type { ObsidianHelpers } from "../../../src/e2e/index.js";
import { expect, FIXTURE_ID, SECOND_ID, test } from "./fixtures.js";

/** The slice of Obsidian's `app` these specs read. */
interface LiveApp {
    plugins: { plugins: Record<string, { ran?: boolean; lastResult?: string | null; transport?: (request: string) => string } | undefined> };
    workspace: { getLeaf(newLeaf: boolean): { view: { getState(): { mode: string; source?: boolean } } } };
    vault: { getConfig(key: string): unknown; setConfig(key: string, value: unknown): void; getMarkdownFiles(): unknown[] };
    metadataCache: { getFileCache(file: unknown): unknown };
    setting: { activeTab?: { id: string } };
}

interface LivePage {
    app: LiveApp;
    document: { body: { classList: { contains(name: string): boolean } } };
    innerWidth: number;
    devicePixelRatio: number;
}

/**
 * Runs `read` in the page with `globalThis` typed as the slice above. It goes over as source text, because the
 * kit's TypeScript has no DOM types to give a plain `win.evaluate` callback; `read` can use nothing from the spec.
 */
function inPage<T>(win: Page, read: (page: LivePage) => T): Promise<T> {
    return win.evaluate<T>(`(${read.toString()})(globalThis)`);
}

/** The fixture plugin's state as plain data: returning the plugin itself would try to serialise the whole app. */
const fixturePlugin = (win: Page): Promise<{ ran?: boolean; lastResult?: string | null } | undefined> =>
    inPage(win, (page) => {
        const plugin = page.app.plugins.plugins["opdk-e2e-fixture"];
        return plugin === undefined ? undefined : { ran: plugin.ran, lastResult: plugin.lastResult };
    });

test.describe("settings", () => {
    test("openSettings opens a plugin tab and a core tab in the main window, closeSettings closes the modal", async ({ obsidian, win, app }) => {
        const content = await obsidian.openSettings(FIXTURE_ID);
        await expect(content.getByText("Settings tab registered after an await in onload().")).toBeVisible();
        expect(await inPage(win, (page) => page.app.setting.activeTab?.id)).toBe(FIXTURE_ID);
        expect(app.windows()).toHaveLength(1);

        await obsidian.openSettings("editor");
        expect(await inPage(win, (page) => page.app.setting.activeTab?.id)).toBe("editor");

        await obsidian.closeSettings();
        await expect(win.locator(".modal.mod-settings")).toHaveCount(0);
    });

    test("openSettings waits for a tab that a plugin registers after the window is up", async ({ obsidian, win }) => {
        await obsidian.runCommand(`${SECOND_ID}:register-tab`);
        // The tab appears 600 ms after the command. The helper polls for it instead of opening Settings without it.
        const content = await obsidian.openSettings(SECOND_ID);
        await expect(content.getByText("Settings tab registered by a command, after a delay.")).toBeVisible();
        expect(await inPage(win, (page) => page.app.setting.activeTab?.id)).toBe(SECOND_ID);
    });

    test("openSettings without a tab opens the modal, and an unknown tab fails listing the registered ones", async ({ obsidian }) => {
        const content = await obsidian.openSettings();
        await expect(content).toBeVisible();
        await obsidian.closeSettings();
        // Waits the full 15 s for a tab that never comes.
        await expect(obsidian.openSettings("no-such-tab")).rejects.toThrow(new RegExp(`No settings tab with id "no-such-tab".*editor.*${FIXTURE_ID}`, "s"));
    });
});

test.describe("settings in a second window", () => {
    test("openSettings fails naming the seed's app.json when Obsidian opens Settings in a popout window", async ({ obsidian, win }) => {
        // A seed vault whose app.json sets settingsPopoutWindow to true behaves like this config value does at runtime.
        await inPage(win, (page) => {
            page.app.vault.setConfig("settingsPopoutWindow", true);
        });
        await expect(obsidian.openSettings()).rejects.toThrow("seed vault's app.json");
    });
});

test.describe("commands and keys", () => {
    test("runCommand runs a command by id and fails with close matches for a typo", async ({ obsidian, win }) => {
        await obsidian.runCommand(`${FIXTURE_ID}:late-command`);
        expect((await fixturePlugin(win))?.ran).toBe(true);
        await expect(obsidian.runCommand(`${FIXTURE_ID}:late-comand`)).rejects.toThrow(`Close matches: ${FIXTURE_ID}:late-command`);
        await expect(obsidian.runCommand("no-such-plugin:zzzzzzzzzzzzzz")).rejects.toThrow("does not exist");
    });

    test("runCommand reports a command whose checkCallback declines", async ({ obsidian }) => {
        await expect(obsidian.runCommand(`${FIXTURE_ID}:never-available`)).rejects.toThrow("checkCallback returned false");
    });

    test("openCommandPalette and runCommandFromPalette use the real palette", async ({ obsidian, win }) => {
        const input = await obsidian.openCommandPalette();
        await expect(input).toBeVisible();
        await obsidian.press("Escape");
        await expect(input).toBeHidden();

        await obsidian.runCommandFromPalette("Late command");
        expect((await fixturePlugin(win))?.ran).toBe(true);
        await expect(win.locator(".prompt-input")).toHaveCount(0);
    });

    test("press maps Mod to the platform's modifier", async ({ obsidian, win }) => {
        await obsidian.press("Mod+P");
        await expect(win.locator(".prompt-input")).toBeVisible();
        await obsidian.press("Escape");
        await expect(win.locator(".prompt-input")).toHaveCount(0);
    });
});

test.describe("files and editor", () => {
    test("openFile opens a note in each mode, also when it is already open in the tab", async ({ obsidian, win }) => {
        const modeOf = (): Promise<{ mode: string; source?: boolean }> => inPage(win, (page) => page.app.workspace.getLeaf(false).view.getState());
        await obsidian.openFile("Welcome.md", { mode: "preview" });
        expect((await modeOf()).mode).toBe("preview");
        await obsidian.openFile("Welcome.md", { mode: "source" });
        expect(await modeOf()).toMatchObject({ mode: "source", source: true });
        await obsidian.openFile("Welcome.md", { mode: "live" });
        expect(await modeOf()).toMatchObject({ mode: "source", source: false });
        await obsidian.openFile("Welcome.md", { mode: "preview" });
        expect((await modeOf()).mode).toBe("preview");
        await expect(obsidian.openFile("Missing.md")).rejects.toThrow("Missing.md is not in the vault");
    });

    test("editor: clear, type key by key without moving the cursor, text, setCursor and selection", async ({ obsidian }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        const editor = obsidian.editor();
        expect(await editor.text()).toContain("# Welcome");
        await editor.clear();
        expect(await editor.text()).toBe("");

        await editor.type("hello");
        // The second call must not click again: a click moves the cursor to the click point, which is not the start
        // of the line, so "X" would not land in front of "hello".
        await obsidian.press("Home");
        await editor.type("X");
        expect(await editor.text()).toBe("Xhello");
        await obsidian.press("End");
        await editor.type(" world");
        expect(await editor.text()).toBe("Xhello world");
        await editor.type("\nsecond line");
        expect(await editor.text()).toBe("Xhello world\nsecond line");

        await editor.setCursor(0, 5);
        expect(await editor.selection()).toEqual({ text: "", anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 5 } });
        await obsidian.press("Shift+Home");
        expect(await editor.selection()).toEqual({ text: "Xhell", anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 0 } });
        await expect(editor.setCursor(-1, 0)).rejects.toThrow(RangeError);
    });

    test("editor.type does not click again after a modal closes, so the cursor stays where it was", async ({ obsidian, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        const editor = obsidian.editor();
        await editor.clear();
        await editor.type("hello");
        await obsidian.press("Home");
        // While the palette is open Obsidian drops mod-active from the leaf; the editor must still be found afterwards.
        await obsidian.openCommandPalette();
        await obsidian.press("Escape");
        await expect(win.locator(".prompt-input")).toHaveCount(0);
        await editor.type("X");
        expect(await editor.text()).toBe("Xhello");
    });

    test("editor.clear fails at once when no note is open", async ({ obsidian }) => {
        await expect(obsidian.editor().clear()).rejects.toThrow("There is no active editor");
    });

    test("editor.text() is the whole document, not just the visible lines", async ({ obsidian }) => {
        await obsidian.openFile("Long.md", { mode: "source" });
        const text = await obsidian.editor().text();
        expect(text).toContain("Paragraph 120.");
        expect(text).toContain("```opdk-lazy");
    });

    test("editor.compose enters text through real composition events, by word and by character", async ({ obsidian, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        const editor = obsidian.editor();
        await editor.clear();
        await inPage(win, (page) => {
            const counts = { start: 0, update: 0, end: 0 };
            const target = page as unknown as { __compositions: typeof counts; document: { addEventListener(type: string, listener: () => void, capture: boolean): void } };
            target.__compositions = counts;
            target.document.addEventListener("compositionstart", () => (counts.start += 1), true);
            target.document.addEventListener("compositionupdate", () => (counts.update += 1), true);
            target.document.addEventListener("compositionend", () => (counts.end += 1), true);
        });
        const counts = (): Promise<{ start: number; update: number; end: number }> =>
            inPage(win, (page) => (page as unknown as { __compositions: { start: number; update: number; end: number } }).__compositions);

        await editor.compose("héllo wörld");
        expect(await editor.text()).toBe("héllo wörld");
        const afterWords = await counts();
        // The input method, not the keyboard, produced this text.
        expect(afterWords.start).toBeGreaterThanOrEqual(1);
        expect(afterWords.update).toBeGreaterThanOrEqual(afterWords.start);
        expect(afterWords.end).toBeGreaterThanOrEqual(1);

        await editor.compose("\nabc", { chunking: "character" });
        expect(await editor.text()).toBe("héllo wörld\nabc");
        const afterCharacters = await counts();
        expect(afterCharacters.start - afterWords.start).toBeGreaterThanOrEqual(4);
    });
});

test.describe("appearance and state", () => {
    test("setTheme switches light and dark and rejects an unknown theme", async ({ obsidian, win }) => {
        const state = (): Promise<{ dark: boolean; light: boolean; config: unknown }> =>
            inPage(win, (page) => ({
                dark: page.document.body.classList.contains("theme-dark"),
                light: page.document.body.classList.contains("theme-light"),
                config: page.app.vault.getConfig("theme"),
            }));
        await obsidian.setTheme({ mode: "dark" });
        expect(await state()).toEqual({ dark: true, light: false, config: "obsidian" });
        await obsidian.setTheme({ mode: "light" });
        expect(await state()).toEqual({ dark: false, light: true, config: "moonstone" });
        await expect(obsidian.setTheme({ mode: "dark", theme: "No Such Theme" })).rejects.toThrow('"No Such Theme" is not installed');
    });

    test("waitForMetadataCache returns once every markdown file is indexed", async ({ obsidian, win }) => {
        await obsidian.waitForMetadataCache();
        const state = await inPage(win, (page) => {
            const files = page.app.vault.getMarkdownFiles();
            return { total: files.length, cached: files.filter((file) => page.app.metadataCache.getFileCache(file) != null).length };
        });
        expect(state.total).toBeGreaterThanOrEqual(3);
        expect(state.cached).toBe(state.total);
    });

    test("clearNotices removes the notices on screen and says how many", async ({ obsidian, win }) => {
        await obsidian.runCommand(`${FIXTURE_ID}:show-notice`);
        await expect(win.locator(".notice")).toHaveCount(1);
        expect(await obsidian.clearNotices()).toBe(1);
        await expect(win.locator(".notice")).toHaveCount(0);
        expect(await obsidian.clearNotices()).toBe(0);
    });

    test("hideProperties hides the properties block of a note, readingView shows the note in reading view", async ({ obsidian, win }) => {
        const block = win.locator(".workspace-leaf.mod-active .markdown-reading-view .metadata-container");
        await obsidian.readingView("Properties.md");
        // The control: the block is there before, so "hidden" below is the helper's doing.
        await expect(block).toBeVisible();
        await obsidian.hideProperties();
        expect(await inPage(win, (page) => page.app.vault.getConfig("propertiesInDocument"))).toBe("hidden");
        await expect(block).toBeHidden();
        // With no path it takes the active note.
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await obsidian.readingView();
        await expect(win.locator(".workspace-leaf.mod-active .markdown-reading-view")).toBeVisible();
    });

    test("scrollThrough draws a block that only draws when it comes into view", async ({ obsidian, win }) => {
        await obsidian.readingView("Long.md");
        await expect(win.locator(".opdk-lazy-rendered")).toHaveCount(0);
        await obsidian.scrollThrough();
        await expect(win.locator(".opdk-lazy-rendered")).toHaveCount(1);
        await expect(obsidian.scrollThrough(".no-such-element")).rejects.toThrow('nothing matches ".no-such-element"');
    });
});

test.describe("mobile", () => {
    test("mobile() gives a 390 x 844 phone at scale 2 with every plugin loaded, desktop() undoes it", async ({ obsidian, win }) => {
        await obsidian.mobile();
        const phone = await inPage(win, (page) => ({
            mobile: page.document.body.classList.contains("is-mobile"),
            phone: page.document.body.classList.contains("is-phone"),
            width: page.innerWidth,
            ratio: page.devicePixelRatio,
            loaded: [page.app.plugins.plugins["opdk-e2e-fixture"] !== undefined, page.app.plugins.plugins["opdk-e2e-second"] !== undefined],
        }));
        expect(phone).toEqual({ mobile: true, phone: true, width: 390, ratio: 2, loaded: [true, true] });
        // A screenshot of the phone is 2 x 390 by 2 x 844 pixels: the PNG header holds width and height.
        const png = await win.screenshot();
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([780, 1688]);

        await obsidian.desktop();
        const desktop = await inPage(win, (page) => ({
            mobile: page.document.body.classList.contains("is-mobile"),
            width: page.innerWidth,
            loaded: [page.app.plugins.plugins["opdk-e2e-fixture"] !== undefined, page.app.plugins.plugins["opdk-e2e-second"] !== undefined],
        }));
        expect(desktop.mobile).toBe(false);
        expect(desktop.width).toBeGreaterThan(390);
        expect(desktop.loaded).toEqual([true, true]);
    });

    test("mobile() takes a size", async ({ obsidian, win }) => {
        await obsidian.mobile({ width: 360, height: 640, scale: 3 });
        expect(await inPage(win, (page) => [page.innerWidth, page.devicePixelRatio])).toEqual([360, 3]);
    });
});

test.describe("mobile layout", () => {
    test("a second mobile() with another width loads the layout of that width again", async ({ obsidian, win }) => {
        const layout = (): Promise<{ phone: boolean; tablet: boolean; width: number }> =>
            inPage(win, (page) => ({
                phone: page.document.body.classList.contains("is-phone"),
                tablet: page.document.body.classList.contains("is-tablet"),
                width: page.innerWidth,
            }));
        await obsidian.mobile({ width: 800 });
        expect(await layout()).toEqual({ phone: false, tablet: true, width: 800 });
        await obsidian.mobile();
        expect(await layout()).toEqual({ phone: true, tablet: false, width: 390 });
    });
});

test.describe("replace", () => {
    const callTransport = async (obsidian: ObsidianHelpers, win: Page): Promise<string | null | undefined> => {
        await obsidian.runCommand(`${FIXTURE_ID}:call-transport`);
        return (await fixturePlugin(win))?.lastResult;
    };

    test("replace swaps a field of the live plugin, records the calls and restores the original", async ({ obsidian, win }) => {
        expect(await callTransport(obsidian, win)).toBe("real:from-command");

        const fake = await obsidian.replace(FIXTURE_ID, "transport", () => (request: string) => `fake:${request}`);
        expect(await callTransport(obsidian, win)).toBe("fake:from-command");
        await callTransport(obsidian, win);
        expect(await fake.calls()).toEqual([["from-command"], ["from-command"]]);

        await fake.restore();
        expect(await callTransport(obsidian, win)).toBe("real:from-command");
        // calls() keeps the two recorded calls; the call after restore() went to the original and was not recorded.
        expect(await fake.calls()).toHaveLength(2);
        await fake.restore();
    });

    test("replace hands its argument to the factory, which keeps state between the calls", async ({ obsidian, win }) => {
        const fake = await obsidian.replace(
            FIXTURE_ID,
            "transport",
            (config: { prefix: string; days: number }) => {
                let count = 0;
                return (request: string) => `${config.prefix}${request}:${String(config.days)}:${String((count += 1))}`;
            },
            { prefix: "fake:", days: 7 },
        );
        expect(await callTransport(obsidian, win)).toBe("fake:from-command:7:1");
        expect(await callTransport(obsidian, win)).toBe("fake:from-command:7:2");
        await fake.restore();
        expect(await callTransport(obsidian, win)).toBe("real:from-command");
    });

    test("replace refuses a plugin that is not loaded, a property that does not exist and a factory that fails", async ({ obsidian, win }) => {
        await expect(obsidian.replace("no-such-plugin", "transport", () => () => 1)).rejects.toThrow('plugin "no-such-plugin" is not loaded');
        await expect(obsidian.replace(FIXTURE_ID, "transprot", () => () => 1)).rejects.toThrow('has no property "transprot"');
        // A factory cannot use a variable of the test: only its source reaches the page.
        const fromTheTest = "unreachable";
        await expect(
            obsidian.replace(FIXTURE_ID, "transport", () => {
                const value = fromTheTest;
                return () => value;
            }),
        ).rejects.toThrow("the replacement factory threw: fromTheTest is not defined");
        await expect(obsidian.replace(FIXTURE_ID, "transport", (() => 1) as never)).rejects.toThrow("did not return a function");
        expect(await callTransport(obsidian, win)).toBe("real:from-command");
    });
});

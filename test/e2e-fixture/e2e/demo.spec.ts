/**
 * The live checklist of the `demo` fixture (src/e2e/demo): films of stills, stills with destination presets,
 * overlays, a clean UI, frozen time, themes, the privacy guard and the freeze before a shot, all against the real
 * Obsidian. Everything is written into a temp folder that the spec removes afterwards.
 *
 * The pauses are none: a film of stills takes its timing from `hold`, not from the machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createObsidianTest, parseFilmManifest, type FilmManifest } from "../../../src/e2e/index.js";
import { slugify } from "../../../src/e2e/demo/names.js";
import { readPngSize } from "../../../src/e2e/demo/png.js";
import { FIXTURE_ID, SECOND_ID, SEED_VAULT } from "./fixtures.js";

const root = path.join(import.meta.dirname, "..");
/** Under the pid, so a listing run in another process never shares it, and nothing is created until a test writes. */
const OUT_DIR = path.join(os.tmpdir(), `opdk-demo-spec-${String(process.pid)}`);
const EDITOR = '.workspace-leaf-content[data-type="markdown"] .cm-content[contenteditable=true]';
const FORBIDDEN = ".opdk-never-in-a-shot";

const { test, expect } = createObsidianTest({
    seedVault: SEED_VAULT,
    plugins: [{ dir: path.join(root, "plugins", FIXTURE_ID) }, { dir: path.join(root, "plugins", SECOND_ID) }],
    window: { width: 1200, height: 800 },
    // Short, so the specs that wait for a target that is not there fail quickly.
    timeouts: { helpers: { ui: 3_000 } },
    demo: { outDir: OUT_DIR, forbiddenSelectors: [FORBIDDEN] },
});

test.afterAll(() => {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
});

interface LivePage {
    app: { vault: { getConfig(key: string): unknown }; workspace: { leftSplit: { collapsed: boolean }; rightSplit: { collapsed: boolean } } };
    moment(): { format(pattern: string): string };
    document: {
        body: { classList: { contains(name: string): boolean } };
        documentElement: { classList: { contains(name: string): boolean } };
        getElementById(id: string): { className: string; style: { display: string; left: string; top: string }; textContent: string | null } | null;
        getAnimations(): { playState: string }[];
    };
    getComputedStyle(element: unknown): { width: string; opacity: string };
    innerWidth: number;
    innerHeight: number;
    devicePixelRatio: number;
}

/** Runs `read` in the page with `globalThis` typed as the slice above (the kit has no DOM types, as in helpers.spec.ts). */
function inPage<T>(win: Page, read: (page: LivePage) => T): Promise<T> {
    return win.evaluate<T>(`(${read.toString()})(globalThis)`);
}

const viewport = (win: Page): Promise<{ width: number; height: number; scale: number }> =>
    inPage(win, (page) => ({ width: page.innerWidth, height: page.innerHeight, scale: page.devicePixelRatio }));

function readFilm(name: string): FilmManifest {
    return parseFilmManifest(fs.readFileSync(path.join(OUT_DIR, "films", name, "manifest.json"), "utf8"));
}

const sizeOf = (file: string): { width: number; height: number } => readPngSize(fs.readFileSync(file));

test.describe("films of stills", () => {
    test("desktop film: cursor, caption and typing end up in 2x frames, named after the test", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await demo.cleanUi();
        await obsidian.collapseSidebars();
        await obsidian.clearNotices();
        const window = await viewport(win);
        const editor = win.locator(EDITOR).first();

        const film = demo.film({ kind: "desktop", captions: ["Click into the note", "Type a line"] });
        // The describe title and the test title: two tests with the same title in different blocks get different folders.
        expect(film.name).toBe(slugify("films of stills desktop film: cursor, caption and typing end up in 2x frames, named after the test"));
        expect(readFilm(film.name).source).toMatchObject({ file: "test/e2e-fixture/e2e/demo.spec.ts", title: "films of stills desktop film: cursor, caption and typing end up in 2x frames, named after the test" });
        expect(film.dir).toBe(path.join(OUT_DIR, "films", film.name));
        expect(readFilm(film.name)).toMatchObject({ complete: false, frames: [], kind: "desktop", fps: 15, scale: 2 });

        const plain = await film.shot({ hold: 1 });
        await demo.caption("Typing into the note");
        await demo.typeSlowly(editor, "\nHello from the kit", { delayMs: 15 });
        await expect(editor).toContainText("Hello from the kit");
        const captioned = await film.shot({ hold: 1.5, caption: 1 });
        await demo.caption(null);
        const bare = await film.shot({ hold: 0.8 });

        expect([plain, captioned, bare]).toEqual([
            { file: "0001.png", hold: 1, caption: null },
            { file: "0002.png", hold: 1.5, caption: 1 },
            { file: "0003.png", hold: 0.8, caption: null },
        ]);
        const manifest = readFilm(film.name);
        expect(manifest.frames).toHaveLength(3);
        expect(manifest).toMatchObject({ width: window.width * 2, height: window.height * 2 });
        const frames = manifest.frames.map((frame) => fs.readFileSync(path.join(film.dir, frame.file)));
        for (const frame of frames) {
            expect(readPngSize(frame)).toEqual({ width: window.width * 2, height: window.height * 2 });
        }
        // The overlays are in the pixels: the same screen with and without the caption bar is not the same picture.
        expect(frames[1]?.equals(frames[2] ?? Buffer.alloc(0))).toBe(false);
        // The cursor is where the click went.
        const cursor = await inPage(win, (page) => {
            const element = page.document.getElementById("opdk-cursor");
            return element === null ? null : { display: element.style.display, left: element.style.left, top: element.style.top };
        });
        const box = await editor.boundingBox();
        expect(cursor?.display).toBe("block");
        expect(Math.abs(parseFloat(cursor?.left ?? "") - ((box?.x ?? 0) + (box?.width ?? 0) / 2))).toBeLessThan(2);
    });

    test("phone film: the tap dot shrinks while pressed, and frames are 2x of the phone", async ({ obsidian, demo, win }) => {
        const wrongKind = demo.film({ kind: "desktop", name: "wrong-kind" });
        await obsidian.mobile();
        await demo.cleanUi();
        const drawers = await inPage(win, (page) => [page.app.workspace.leftSplit.collapsed, page.app.workspace.rightSplit.collapsed]);
        expect(drawers).toEqual([true, true]);
        await expect(wrongKind.shot({ hold: 1 })).rejects.toThrow(/desktop film but the window is in the mobile emulation/);
        await obsidian.openFile("Welcome.md");
        const window = await viewport(win);
        expect(window).toEqual({ width: 390, height: 844, scale: 2 });

        const film = demo.film({ kind: "phone", captions: ["Tap the note"] });
        let pressed: { className: string | undefined; width: string } | undefined;
        await demo.tap(win.locator(EDITOR).first(), {
            whilePressed: async () => {
                pressed = await inPage(win, (page) => ({
                    className: page.document.getElementById("opdk-tap")?.className,
                    width: page.getComputedStyle(page.document.getElementById("opdk-tap")).width,
                }));
                await film.shot({ hold: 0.4, caption: 0 });
            },
        });
        await film.shot({ hold: 1 });

        expect(pressed?.className).toContain("opdk-down");
        expect(pressed?.width).toBe("36px");
        // The dot goes away with the finger, so the next frame has no dot.
        const released = await inPage(win, (page) => page.document.getElementById("opdk-tap")?.style.display);
        expect(released).toBe("none");
        const manifest = readFilm(film.name);
        expect(manifest).toMatchObject({ kind: "phone", width: 780, height: 1688, frames: [{ hold: 0.4, caption: 0 }, { hold: 1, caption: null }] });
        expect(sizeOf(path.join(film.dir, "0001.png"))).toEqual({ width: 780, height: 1688 });
    });

    test("overlays, clean UI and frozen time survive reload(), and a film goes on across it", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await demo.freezeTime(new Date("2026-03-14T09:26:00"));
        await demo.cleanUi();
        await demo.caption("Still here after the reload");
        await demo.moveAndClick(win.locator(EDITOR).first());
        const film = demo.film({ kind: "desktop" });
        await film.shot({ hold: 1 });
        await expect(win.locator(".status-bar")).toBeHidden();

        await obsidian.reload();
        await obsidian.openFile("Welcome.md", { mode: "source" });

        const after = await inPage(win, (page) => ({
            time: page.moment().format("YYYY-MM-DD HH:mm"),
            showRibbon: page.app.vault.getConfig("showRibbon"),
            showViewHeader: page.app.vault.getConfig("showViewHeader"),
            showInlineTitle: page.app.vault.getConfig("showInlineTitle"),
            caption: page.document.getElementById("opdk-caption")?.textContent,
            captionShown: page.document.getElementById("opdk-caption")?.style.display,
            cursorShown: page.document.getElementById("opdk-cursor")?.style.display,
            statusBarHidden: page.document.documentElement.classList.contains("opdk-hide-status-bar"),
            tabHeadersHidden: page.document.documentElement.classList.contains("opdk-hide-tab-headers"),
            sidebarsCollapsed: [page.app.workspace.leftSplit.collapsed, page.app.workspace.rightSplit.collapsed],
        }));
        expect(after).toEqual({
            time: "2026-03-14 09:26",
            showRibbon: false,
            showViewHeader: false,
            showInlineTitle: false,
            caption: "Still here after the reload",
            captionShown: "block",
            cursorShown: "block",
            statusBarHidden: true,
            tabHeadersHidden: true,
            sidebarsCollapsed: [true, true],
        });
        await expect(win.locator(".status-bar")).toBeHidden();
        await expect(win.locator(".mod-root .workspace-tab-header-container").first()).toBeHidden();
        await expect(win.locator(".workspace-ribbon.mod-left")).toBeHidden();

        await film.shot({ hold: 1 });
        const manifest = readFilm(film.name);
        expect(manifest.frames).toHaveLength(2);
        const [first, second] = manifest.frames.map((frame) => sizeOf(path.join(film.dir, frame.file)));
        expect(second).toEqual(first);

        // Showing everything again is the same call with false.
        await demo.cleanUi({ ribbon: false, statusBar: false, tabHeaders: false, viewHeader: false, inlineTitle: false });
        await expect(win.locator(".status-bar")).toBeVisible();
        await expect(win.locator(".mod-root .workspace-tab-header-container").first()).toBeVisible();
    });

    test("cleanUi folds the sidebars unless told not to, and cursor: false keeps the arrow out after real clicks", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await obsidian.expandSidebars();
        const folded = (): Promise<boolean[]> => inPage(win, (page) => [page.app.workspace.leftSplit.collapsed, page.app.workspace.rightSplit.collapsed]);
        await demo.cleanUi({ sidebars: false });
        expect(await folded()).toEqual([false, false]);
        await demo.cleanUi();
        expect(await folded()).toEqual([true, true]);

        const arrow = (): Promise<string | undefined> => inPage(win, (page) => page.document.getElementById("opdk-cursor")?.style.display);
        const film = demo.film({ kind: "desktop", cursor: false });
        await demo.moveAndClick(win.locator(EDITOR).first());
        await film.shot({ hold: 1 });
        expect(await arrow()).toBe("none");
        // A plain Playwright click moves the mouse; the arrow must stay off.
        await win.locator(EDITOR).first().click();
        await film.shot({ hold: 1 });
        expect(await arrow()).toBe("none");

        const loud = demo.film({ kind: "desktop", name: "with-cursor" });
        await win.locator(EDITOR).first().click();
        await loud.shot({ hold: 1 });
        expect(await arrow()).toBe("block");
    });
});

test.describe("stills", () => {
    test("each preset gives exactly its pixels and puts the window back", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        const before = await viewport(win);
        const expected = {
            readme: { width: 1000, height: 640 },
            "listing-desktop": { width: 1200, height: 800 },
            "listing-phone": { width: 900, height: 1600 },
            social: { width: 1200, height: 630 },
        } as const;
        for (const [preset, size] of Object.entries(expected)) {
            const still = await demo.still(`preset-${preset}`, { preset: preset as keyof typeof expected });
            expect({ preset, ...still }).toEqual({ preset, file: path.join(OUT_DIR, "stills", `preset-${preset}.png`), ...size });
            expect({ preset, ...sizeOf(still.file) }).toEqual({ preset, ...size });
            expect(await viewport(win)).toEqual(before);
        }
    });

    test("a clip is a rectangle or an element, padded, and the picture is at the density asked for", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        const rect = await demo.still("clip-rect", { clip: { x: 10, y: 20, width: 300, height: 200 }, scale: 1 });
        expect(sizeOf(rect.file)).toEqual({ width: 300, height: 200 });
        const rect3 = await demo.still("clip-rect-3x", { clip: { x: 10, y: 20, width: 300, height: 200 }, scale: 3 });
        expect(sizeOf(rect3.file)).toEqual({ width: 900, height: 600 });

        const editor = win.locator(EDITOR).first();
        const box = await editor.boundingBox();
        const padded = await demo.still("clip-element", { clip: editor, padding: 12, scale: 1 });
        expect(padded.width).toBeGreaterThanOrEqual(Math.floor(box?.width ?? 0) + 12);
        expect(sizeOf(padded.file)).toEqual({ width: padded.width, height: padded.height });

        // A clip that runs past the window fails, it is not cut.
        await expect(demo.still("clip-too-big", { clip: { x: 0, y: 0, width: 5000, height: 100 } })).rejects.toThrow(/outside the \d+ x \d+ window/);
        expect(fs.existsSync(path.join(OUT_DIR, "stills", "clip-too-big.png"))).toBe(false);
        // A missing target fails, it is not skipped.
        await expect(demo.still("clip-missing", { clip: win.locator("#opdk-no-such-element") })).rejects.toThrow(/was not visible within/);
    });
});

test.describe("themes", () => {
    test("one scene, two themes: <name>-light and <name>-dark, with different pictures", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        const seen: string[] = [];
        await demo.themes(["light", "dark"], async (mode) => {
            const bodyClass = await inPage(win, (page) => (page.document.body.classList.contains("theme-dark") ? "dark" : "light"));
            seen.push(`${mode}:${bodyClass}`);
            const film = demo.film({ kind: "desktop", name: "scheme" });
            await film.shot({ hold: 1 });
            await demo.still("scheme-card");
        });
        expect(seen).toEqual(["light:light", "dark:dark"]);
        expect(readFilm("scheme-light")).toMatchObject({ name: "scheme-light", theme: "light" });
        expect(readFilm("scheme-dark")).toMatchObject({ name: "scheme-dark", theme: "dark" });
        const light = fs.readFileSync(path.join(OUT_DIR, "stills", "scheme-card-light.png"));
        const dark = fs.readFileSync(path.join(OUT_DIR, "stills", "scheme-card-dark.png"));
        expect(light.equals(dark)).toBe(false);
    });
});

test.describe("the shot path", () => {
    test("a visible forbidden selector fails the shot, from the options or from the call, and nothing is written", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await win.evaluate(
            `(() => { const el = document.createElement("div"); el.className = "opdk-never-in-a-shot"; el.textContent = "secret"; ` +
                `el.style.cssText = "position:fixed;top:0;left:0;width:60px;height:20px"; document.body.appendChild(el); })()`,
        );
        const film = demo.film({ kind: "desktop" });
        await expect(film.shot({ hold: 1 })).rejects.toThrow(/forbidden selector ".opdk-never-in-a-shot" is visible/);
        expect(readFilm(film.name).frames).toEqual([]);
        expect(fs.readdirSync(film.dir).sort()).toEqual(["manifest.json", "owner.json"]);
        // The page was thawed although the shot failed.
        expect(await inPage(win, (page) => page.document.documentElement.classList.contains("opdk-shooting"))).toBe(false);

        await win.evaluate(`document.querySelector("${FORBIDDEN}").style.display = "none"`);
        await film.shot({ hold: 1 });
        expect(readFilm(film.name).frames).toHaveLength(1);

        await expect(demo.still("per-call", { forbiddenSelectors: [".workspace"] })).rejects.toThrow(/forbidden selector ".workspace" is visible/);
        expect(fs.existsSync(path.join(OUT_DIR, "stills", "per-call.png"))).toBe(false);
    });

    test("a retake replaces the frames of the earlier run", async ({ obsidian, demo }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        const stale = path.join(OUT_DIR, "films", "retake");
        fs.mkdirSync(stale, { recursive: true });
        fs.writeFileSync(path.join(stale, "0009.png"), "from an earlier run");
        const film = demo.film({ kind: "desktop", name: "retake" });
        expect(fs.readdirSync(film.dir).sort()).toEqual(["manifest.json", "owner.json"]);
        await film.shot({ hold: 1 });
        expect(fs.readdirSync(film.dir).sort()).toEqual(["0001.png", "manifest.json", "owner.json"]);
    });

    test("typeSlowly without a target fails when nothing editable has focus", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await win.evaluate("document.activeElement && document.activeElement.blur()");
        await expect(demo.typeSlowly("nobody listens")).rejects.toThrow(/nothing editable has focus/);
        await win.locator(EDITOR).first().click();
        await demo.typeSlowly("heard", { delayMs: 5 });
        await expect(win.locator(EDITOR).first()).toContainText("heard");
    });

    test("transitions and animations are finished and the caret is hidden while a frame is taken", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await win.locator(EDITOR).first().click();
        await win.evaluate(
            `(() => {
                const el = document.createElement("div");
                el.id = "opdk-anim";
                el.style.cssText = "position:fixed;top:300px;left:300px;width:40px;height:40px;background:#c00;opacity:0;transition:opacity 5s";
                document.body.appendChild(el);
                getComputedStyle(el).opacity;
                el.style.opacity = "1";
                const walk = el.animate([{ transform: "translateX(0)" }, { transform: "translateX(100px)" }], { duration: 5000 });
                const blink = el.animate([{ outlineOffset: "0px" }, { outlineOffset: "2px" }], { duration: 500, iterations: Infinity });
                window.__opdkAnimations = { walk, blink };
                window.__opdkShootLog = [];
                new MutationObserver(() => {
                    if (!document.documentElement.classList.contains("opdk-shooting")) return;
                    const layer = document.querySelector(".cm-cursorLayer");
                    const content = document.querySelector(".cm-content");
                    window.__opdkShootLog.push({
                        layer: layer ? getComputedStyle(layer).visibility : "no layer",
                        caret: content ? getComputedStyle(content).caretColor : "no content",
                    });
                }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
            })()`,
        );
        await demo.still("frozen");
        const state = await win.evaluate<{ opacity: string; walk: string; blink: string; running: number; log: { layer: string; caret: string }[] }>(
            `(() => ({
                opacity: getComputedStyle(document.getElementById("opdk-anim")).opacity,
                walk: window.__opdkAnimations.walk.playState,
                blink: window.__opdkAnimations.blink.playState,
                running: document.getAnimations().filter((a) => a.playState === "running").length,
                log: window.__opdkShootLog,
            }))()`,
        );
        expect(state.opacity).toBe("1");
        expect(state.walk).toBe("finished");
        // An endless animation is paused for the shot and plays again afterwards.
        expect(state.blink).toBe("running");
        expect(state.running).toBeGreaterThanOrEqual(1);
        expect(state.log).toEqual([{ layer: "hidden", caret: "rgba(0, 0, 0, 0)" }]);
    });
});

test.describe("settle", () => {
    /** Runs `source` in the page; it goes over as text because the kit's TypeScript has no DOM types. */
    const inWindow = (win: Page, source: string): Promise<unknown> => win.evaluate(`(() => { ${source} })()`);
    /**
     * A page that is busy for `busyMs` and then adds a full-window block of `color` with this id: the body changes
     * every 100 ms (inside settle()'s 150 ms quiet window, like a view that renders in steps), the block lands last.
     * A change that is only scheduled further ahead than the quiet window cannot be seen coming, so it is not what
     * settle() is for.
     */
    const addLater = (win: Page, id: string, color: string, busyMs: number): Promise<unknown> =>
        inWindow(
            win,
            `let ticks = ${String(Math.round(busyMs / 100))};
             const timer = setInterval(() => {
                 ticks -= 1;
                 if (ticks > 0) { document.body.dataset.opdkTick = String(ticks); return; }
                 clearInterval(timer);
                 const el = document.createElement("div"); el.id = ${JSON.stringify(id)}; el.style.cssText = "position:fixed;inset:0;z-index:99999;background:${color}"; document.body.append(el);
             }, 100);`,
        );
    const present = (win: Page, id: string): Promise<boolean> => win.evaluate(`document.getElementById(${JSON.stringify(id)}) !== null`);

    test("waits through a page that changes in steps, and an endless animation does not hold it up", async ({ obsidian, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await inWindow(
            win,
            `const style = document.createElement("style"); style.textContent = "@keyframes opdk-spin { to { transform: rotate(360deg) } }"; document.head.append(style);
             const spinner = document.createElement("div"); spinner.style.cssText = "position:fixed;left:0;top:0;width:10px;height:10px;animation:opdk-spin 1s linear infinite"; document.body.append(spinner);`,
        );
        await addLater(win, "opdk-late", "red", 500);
        expect(await present(win, "opdk-late")).toBe(false);
        await obsidian.settle();
        // Without settle() the block would not be there yet: it lands 500 ms after the call above, in steps 100 ms apart.
        expect(await present(win, "opdk-late")).toBe(true);
    });

    test("fails naming settle(), the budget and the way out while the page keeps changing, and root watches only a calm part", async ({ obsidian, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await inWindow(
            win,
            `const calm = document.createElement("div"); calm.id = "opdk-calm"; document.body.append(calm);
             const busy = document.createElement("div"); busy.id = "opdk-busy"; document.body.append(busy);
             setInterval(() => { busy.textContent = String(performance.now()); }, 20);`,
        );
        await expect(obsidian.settle()).rejects.toThrow(/settle\(\): the page was not quiet for 150 ms within 3000 ms \(the DOM changed \d+ ms ago\)\. Raise timeouts\.helpers\.ui/);
        await obsidian.settle({ root: "#opdk-calm" });
        await expect(obsidian.settle({ root: "#opdk-nope" })).rejects.toThrow('settle(): nothing matches root "#opdk-nope"');
        await expect(obsidian.settle({ quietMs: 3000 })).rejects.toThrow(/quietMs \(3000 ms\) is not below the wait budget/);
    });

    test("a still and a shot with settle: true wait for the page first; without it they are taken as the page is", async ({ obsidian, demo, win }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        await demo.cleanUi();
        await addLater(win, "opdk-late-still", "#d4145a", 500);
        const early = await demo.still("early");
        expect(await present(win, "opdk-late-still")).toBe(false);
        const settled = await demo.still("settled", { settle: true });
        expect(await present(win, "opdk-late-still")).toBe(true);
        expect(fs.readFileSync(early.file).equals(fs.readFileSync(settled.file))).toBe(false);

        const film = demo.film({ kind: "desktop", name: "settle-film" });
        await addLater(win, "opdk-late-shot", "#1456d4", 500);
        await film.shot({ hold: 1 });
        expect(await present(win, "opdk-late-shot")).toBe(false);
        await film.shot({ hold: 1, settle: true });
        expect(await present(win, "opdk-late-shot")).toBe(true);
        expect(readFilm("settle-film").frames).toHaveLength(2);
    });
});

test.describe.serial("a name two tests share", () => {
    test("the first test writes a film and a still", async ({ obsidian, demo }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        const film = demo.film({ kind: "desktop", name: "shared-name" });
        await film.shot({ hold: 1 });
        await demo.still("shared-name");
        expect(readFilm("shared-name").frames).toHaveLength(1);
    });

    test("the second test is refused the same names and the first pictures stay", async ({ obsidian, demo }) => {
        await obsidian.openFile("Welcome.md", { mode: "source" });
        expect(() => demo.film({ kind: "desktop", name: "shared-name" })).toThrow(/film "shared-name" was already written in this run by another test/);
        await expect(demo.still("shared-name")).rejects.toThrow(/still "shared-name" was already written in this run by another test/);
        expect(readFilm("shared-name").frames).toHaveLength(1);
        expect(fs.existsSync(path.join(OUT_DIR, "stills", "shared-name.png"))).toBe(true);
    });
});

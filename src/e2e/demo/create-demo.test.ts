import fs from "node:fs";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeDemoWindow, fakePng, type FakeDemoWindow } from "../../test-support/demo-fakes.js";
import { testTmpRoot } from "../../test-support/test-tmp.js";
import { createDeviceMetricsTracker } from "../helpers/device-metrics.js";
import { createDemo, type DemoController, type DemoDeps } from "./create-demo.js";
import { parseFilmManifest } from "./manifest.js";
import { resolveDemoOptions } from "./options.js";

let root: string;
let fake: FakeDemoWindow;
let themes: string[];
let sidebarCalls: number;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(testTmpRoot(), "opdk-e2e-demo-test-"));
    fake = createFakeDemoWindow();
    themes = [];
    sidebarCalls = 0;
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function setUp(overrides: Partial<DemoDeps> = {}): DemoController {
    const cdp = overrides.cdp ?? (() => Promise.resolve(fake.cdpSession));
    return createDemo({
        win: fake.win,
        cdp,
        // The tracker sends through the same (possibly wrapped) session the demo shoots with, as the fixture wires it.
        deviceMetrics: overrides.deviceMetrics ?? createDeviceMetricsTracker(cdp),
        setTheme: (options) => {
            themes.push(options.mode);
            return Promise.resolve();
        },
        options: resolveDemoOptions({ outDir: "out" }, root),
        collapseSidebars: () => {
            sidebarCalls++;
            fake.log.push("collapseSidebars");
            return Promise.resolve();
        },
        settle: () => {
            fake.log.push("settle");
            return Promise.resolve();
        },
        uiTimeoutMs: 555,
        seedVault: "/plugin/e2e/vault",
        seedVaultSource: "option",
        cwd: "/plugin",
        testTitle: "Wizard tour: pick sports",
        source: { testId: "t-1", title: "Wizard tour: pick sports", file: "e2e/wizard.spec.ts" },
        runId: "run-1",
        ...overrides,
    });
}

/** The fake session's `send` without Playwright's per-command types, for stubs that wrap it. */
const rawSend = (session: object, method: string, params?: unknown): Promise<unknown> =>
    (session as { send: (method: string, params?: unknown) => Promise<unknown> }).send(method, params);
const out = (...segments: string[]): string => path.join(root, "out", ...segments);
const manifestOf = (name: string) => parseFilmManifest(fs.readFileSync(out("films", name, "manifest.json"), "utf8"));
const target = (selector: string): Locator => fake.win.locator(selector);
const logged = (prefix: string): string[] => fake.log.filter((entry) => entry.startsWith(prefix));

describe("film: a series of frames", () => {
    it("is named after the test, starts with an incomplete manifest, and writes frames and manifest after every shot", async () => {
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop", captions: ["Open", "Done"] });
        expect(film.name).toBe("wizard-tour-pick-sports");
        expect(film.dir).toBe(out("films", "wizard-tour-pick-sports"));
        expect(manifestOf(film.name)).toMatchObject({
            kind: "desktop",
            fps: 15,
            scale: 2,
            complete: false,
            frames: [],
            source: { testId: "t-1", title: "Wizard tour: pick sports", file: "e2e/wizard.spec.ts" },
        });

        const first = await film.shot({ hold: 1.2, caption: 0 });
        const second = await film.shot({ hold: 2 });
        expect(first).toEqual({ file: "0001.png", hold: 1.2, caption: 0 });
        expect(second).toEqual({ file: "0002.png", hold: 2, caption: null });
        expect(fs.existsSync(path.join(film.dir, "0001.png"))).toBe(true);
        expect(fs.existsSync(path.join(film.dir, "0002.png"))).toBe(true);
        expect(manifestOf(film.name)).toMatchObject({ width: 2400, height: 1600, complete: false, frames: [first, second] });
    });

    it("shoots at the film's scale through the shared CDP session: one override, then captures at that density", async () => {
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop", scale: 3 });
        await film.shot({ hold: 1 });
        await film.shot({ hold: 1 });
        expect(fake.cdp.map((c) => c.method)).toEqual([
            "Emulation.setDeviceMetricsOverride",
            "Page.captureScreenshot",
            "Page.captureScreenshot",
        ]);
        expect(fake.cdp[0]?.params).toEqual({ width: 1200, height: 800, deviceScaleFactor: 3, mobile: false });
        expect(manifestOf(film.name)).toMatchObject({ width: 3600, height: 2400, scale: 3 });
    });

    it("uses the scale of the demo option by default", async () => {
        const { demo } = setUp({ options: resolveDemoOptions({ outDir: "out", scale: 1 }, root) });
        const film = demo.film({ kind: "desktop" });
        await film.shot({ hold: 1 });
        expect(manifestOf(film.name)).toMatchObject({ scale: 1, width: 1200, height: 800 });
        expect(fake.cdp.map((c) => c.method)).toEqual(["Page.captureScreenshot"]);
    });

    it("freezes before the forbidden check and the capture, and thaws afterwards", async () => {
        const { demo } = setUp({ options: resolveDemoOptions({ outDir: "out", forbiddenSelectors: [".secret"] }, root) });
        const film = demo.film({ kind: "desktop" });
        await film.shot({ hold: 1 });
        const order = fake.log.filter((e) => e === "freeze" || e === "release" || e.startsWith("count:"));
        expect(order).toEqual(["freeze", "count:.secret:true", "release"]);
        const events = [...fake.log, ...fake.cdp.map((c) => c.method)];
        expect(events).toContain("Page.captureScreenshot");
    });

    it("releases the shot even when the freeze itself fails, and writes no frame", async () => {
        fake.freezeFails = true;
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop" });
        await expect(film.shot({ hold: 1 })).rejects.toThrow("InvalidStateError");
        expect(fake.log.filter((e) => e === "freeze" || e === "release")).toEqual(["freeze", "release"]);
        expect(manifestOf(film.name).frames).toEqual([]);
    });

    it("installs the overlay once, as an init script and in the current document, before the first capture", async () => {
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop" });
        await film.shot({ hold: 1 });
        await film.shot({ hold: 1 });
        expect(fake.log.filter((e) => e === "initScript:installOverlay")).toHaveLength(1);
        expect(fake.log.filter((e) => e === "evaluate:installOverlay")).toHaveLength(1);
        expect(fake.log.indexOf("evaluate:installOverlay")).toBeLessThan(fake.log.indexOf("freeze"));
    });

    it("a retake replaces the frames of the earlier run and leaves other films alone", () => {
        const dir = out("films", "wizard-tour-pick-sports");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "0007.png"), "old");
        fs.mkdirSync(out("films", "other"), { recursive: true });
        fs.writeFileSync(out("films", "other", "keep.txt"), "keep");
        const { demo } = setUp();
        demo.film({ kind: "desktop" });
        expect(fs.readdirSync(dir).sort()).toEqual(["manifest.json", "owner.json"]);
        expect(fs.readFileSync(out("films", "other", "keep.txt"), "utf8")).toBe("keep");
    });

    it("refuses a second film of the same name in one test", () => {
        const { demo } = setUp();
        demo.film({ kind: "desktop" });
        expect(() => demo.film({ kind: "desktop" })).toThrow(/film "wizard-tour-pick-sports" was already started in this test/);
        expect(() => demo.film({ kind: "desktop", name: "second" })).not.toThrow();
    });

    it("checks the options before touching the disk", () => {
        const { demo } = setUp();
        expect(() => demo.film({ kind: "tablet" as never })).toThrow(/kind must be/);
        expect(() => demo.film({ kind: "desktop", fps: 0 })).toThrow(/fps/);
        expect(() => demo.film({ kind: "desktop", scale: 9 })).toThrow(/scale/);
        expect(() => demo.film({ kind: "desktop", captions: [1] as never })).toThrow(/captions/);
        expect(() => demo.film({ kind: "desktop", name: "../x" })).toThrow(/film name/);
        expect(() => demo.film({ kind: "desktop", padding: 8 })).toThrow(/padding .* needs a clip/);
        expect(fs.existsSync(out())).toBe(false);
    });

    it("rejects bad shot arguments without writing a frame", async () => {
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop", captions: ["a"] });
        await expect(film.shot({ hold: 0 })).rejects.toThrow(/hold/);
        await expect(film.shot({ hold: 1, caption: 3 })).rejects.toThrow(/caption 3/);
        expect(manifestOf(film.name).frames).toEqual([]);
        expect(fake.cdp).toEqual([]);
    });

    it("fails a frame of another size and writes nothing for it", async () => {
        fake.visible.set("#card", { x: 10, y: 10, width: 100, height: 50 });
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop", scale: 1 });
        await film.shot({ hold: 1 });
        await expect(film.shot({ hold: 1, clip: target("#card") })).rejects.toThrow(/frame 2 is 100 x 50 px but the first frame is 1200 x 800/);
        expect(fs.readdirSync(film.dir).sort()).toEqual(["0001.png", "manifest.json", "owner.json"]);
    });

    it("fails when the capture is not at the requested density", async () => {
        fake.captureScaleOverride = 1;
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop" });
        await expect(film.shot({ hold: 1 })).rejects.toThrow(/film "wizard-tour-pick-sports", frame 1: the frame is 1200 x 800 px, expected 2400 x 1600/);
        expect(fake.log).toContain("release");
        expect(fs.readdirSync(film.dir).sort()).toEqual(["manifest.json", "owner.json"]);
    });

    it("fails when the window never gets the device metrics it was told to have", async () => {
        const session = fake.cdpSession;
        const { demo } = setUp({
            cdp: () =>
                Promise.resolve({
                    ...session,
                    send: (method: string) => (method === "Emulation.setDeviceMetricsOverride" ? Promise.resolve({}) : Promise.reject(new Error("no"))),
                } as typeof session),
        });
        const film = demo.film({ kind: "desktop" });
        await expect(film.shot({ hold: 1 })).rejects.toThrow(/did not become 1200 x 800 at scale 2 within 555 ms/);
    });
});

describe("film cursor option", () => {
    const cursorCalls = (): string[] => logged("overlay:").filter((entry) => entry.includes("cursorEnabled"));

    it("sends nothing for a film that keeps the cursor", async () => {
        const film = setUp().demo.film({ kind: "desktop" });
        await film.shot({ hold: 1 });
        expect(cursorCalls()).toEqual([]);
    });

    it("hides the arrow before the first shot of a cursor: false film, once for all its shots", async () => {
        const film = setUp().demo.film({ kind: "desktop", cursor: false });
        await film.shot({ hold: 1 });
        await film.shot({ hold: 1 });
        expect(cursorCalls()).toEqual(['overlay:{"method":"cursorEnabled","arg":false}']);
        expect(fake.log.indexOf('overlay:{"method":"cursorEnabled","arg":false}')).toBeLessThan(fake.log.indexOf("freeze"));
    });

    it("keeps it hidden when a click moves the mouse between two shots: the arrow is not switched back on", async () => {
        const { demo } = setUp();
        fake.visible.set("#next", { x: 0, y: 0, width: 10, height: 10 });
        const film = demo.film({ kind: "desktop", cursor: false });
        await film.shot({ hold: 1 });
        await demo.moveAndClick(target("#next"));
        await film.shot({ hold: 1 });
        expect(cursorCalls()).toEqual(['overlay:{"method":"cursorEnabled","arg":false}']);
    });

    it("shows the arrow again for a later film or still of the same test that wants it", async () => {
        const { demo } = setUp();
        const quiet = demo.film({ kind: "desktop", name: "quiet", cursor: false });
        await quiet.shot({ hold: 1 });
        const loud = demo.film({ kind: "desktop", name: "loud" });
        await loud.shot({ hold: 1 });
        await quiet.shot({ hold: 1 });
        await demo.still("picture");
        expect(cursorCalls()).toEqual([
            'overlay:{"method":"cursorEnabled","arg":false}',
            'overlay:{"method":"cursorEnabled","arg":true}',
            'overlay:{"method":"cursorEnabled","arg":false}',
            'overlay:{"method":"cursorEnabled","arg":true}',
        ]);
    });

    it("rejects a cursor option that is not a boolean, before the film folder is touched", () => {
        const { demo } = setUp();
        expect(() => demo.film({ kind: "desktop", cursor: "no" as never })).toThrow(/cursor must be true \(show the arrow\) or false \(hide it\)/);
        expect(fs.existsSync(out("films"))).toBe(false);
    });
});

describe("still cursor option", () => {
    const cursorCalls = (): string[] => logged("overlay:").filter((entry) => entry.includes("cursorEnabled"));
    const hide = 'overlay:{"method":"cursorEnabled","arg":false}';
    const show = 'overlay:{"method":"cursorEnabled","arg":true}';

    it("sends nothing for a still that keeps the arrow", async () => {
        await setUp().demo.still("picture");
        expect(cursorCalls()).toEqual([]);
    });

    it("hides the arrow before the capture of a cursor: false still", async () => {
        const { demo } = setUp();
        await demo.still("quiet", { cursor: false });
        expect(cursorCalls()).toEqual([hide]);
        expect(fake.log.indexOf(hide)).toBeLessThan(fake.log.indexOf("freeze"));
    });

    it("does not leak into the next still or film, and leaves a cursor: false film alone", async () => {
        const { demo } = setUp();
        await demo.still("quiet", { cursor: false });
        await demo.still("loud");
        const film = demo.film({ kind: "desktop" });
        await film.shot({ hold: 1 });
        expect(cursorCalls()).toEqual([hide, show]);
        const quietFilm = demo.film({ kind: "desktop", name: "quiet-film", cursor: false });
        await quietFilm.shot({ hold: 1 });
        await demo.still("quiet-again", { cursor: false });
        await quietFilm.shot({ hold: 1 });
        expect(cursorCalls()).toEqual([hide, show, hide]);
    });

    it("rejects a cursor option that is not a boolean, before anything is written", async () => {
        const { demo } = setUp();
        await expect(demo.still("bad", { cursor: "no" as never })).rejects.toThrow(/still "bad": cursor must be true \(show the arrow\) or false \(hide it\), got "no"/);
        expect(fs.existsSync(out("stills"))).toBe(false);
        expect(cursorCalls()).toEqual([]);
    });
});

describe("film kind guard", () => {
    it("refuses a phone film in a window that is not mobile, telling to call mobile()", async () => {
        const { demo } = setUp();
        const film = demo.film({ kind: "phone" });
        await expect(film.shot({ hold: 1 })).rejects.toThrow(/the film is a phone film but the window is not in the mobile emulation. Call obsidian.mobile\(\) first/);
        expect(fake.cdp).toEqual([]);
    });

    it("refuses a desktop film in the mobile emulation", async () => {
        fake.mobile = true;
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop" });
        await expect(film.shot({ hold: 1 })).rejects.toThrow(/desktop film but the window is in the mobile emulation. Call obsidian.desktop\(\)/);
    });

    it("lets a phone film shoot in the mobile emulation at the phone's CSS size", async () => {
        fake.mobile = true;
        fake.viewport = { width: 390, height: 844, scale: 2 };
        const { demo } = setUp();
        const film = demo.film({ kind: "phone" });
        await film.shot({ hold: 1 });
        expect(fake.cdp.map((c) => c.method)).toEqual(["Page.captureScreenshot"]);
        expect(manifestOf(film.name)).toMatchObject({ kind: "phone", width: 780, height: 1688 });
    });
});

describe("clips", () => {
    it("clips to an element's box, padded, in whole CSS pixels, and sizes the frame from the clip", async () => {
        fake.visible.set("#card", { x: 100.5, y: 50, width: 200, height: 100 });
        const { demo } = setUp();
        const still = await demo.still("card", { clip: target("#card"), padding: 10 });
        expect(fake.cdp.at(-1)?.params).toEqual({ format: "png", clip: { x: 90, y: 40, width: 221, height: 120, scale: 1 } });
        expect(still).toMatchObject({ width: 442, height: 240 });
    });

    it("clips to a rectangle", async () => {
        const { demo } = setUp();
        const still = await demo.still("rect", { clip: { x: 0, y: 0, width: 600, height: 400 } });
        expect(still).toMatchObject({ width: 1200, height: 800 });
    });

    it("fails when the target is not visible, naming it, the wait and what to do", async () => {
        const { demo } = setUp();
        await expect(demo.still("gone", { clip: target("#nope") })).rejects.toThrow(/still "gone": locator\('#nope'\) was not visible within 555 ms .*fail on a missing target/s);
        expect(fake.log).toContain("release");
    });

    it("fails when the target runs past the window", async () => {
        fake.visible.set("#tall", { x: 0, y: 100, width: 300, height: 900 });
        const { demo } = setUp();
        await expect(demo.still("tall", { clip: target("#tall") })).rejects.toThrow(/outside the 1200 x 800 window/);
    });

    it("fails when a visible target has no box", async () => {
        const { demo } = setUp();
        fake.visible.set("#ghost", { x: 0, y: 0, width: 1, height: 1 });
        const locator = { ...target("#ghost"), boundingBox: () => Promise.resolve(null) } as unknown as Locator;
        await expect(demo.still("ghost", { clip: locator })).rejects.toThrow(/has no bounding box/);
    });

    it("lets a shot override the film's clip and padding", async () => {
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop", scale: 1, clip: { x: 0, y: 0, width: 100, height: 100 } });
        await film.shot({ hold: 1 });
        await film.shot({ hold: 1, clip: { x: 10, y: 10, width: 100, height: 100 } });
        const clips = fake.cdp.filter((c) => c.method === "Page.captureScreenshot").map((c) => (c.params as { clip: { x: number } }).clip.x);
        expect(clips).toEqual([0, 10]);
    });
});

describe("still", () => {
    it("writes <outDir>/stills/<name>.png and returns the path and pixel size", async () => {
        const { demo } = setUp();
        const result = await demo.still("hero");
        expect(result).toEqual({ file: out("stills", "hero.png"), width: 2400, height: 1600 });
        expect(fs.readFileSync(result.file).equals(fakePng(2400, 1600))).toBe(true);
    });

    it("replaces an earlier picture of the same name", async () => {
        const { demo } = setUp();
        await demo.still("hero", { scale: 1 });
        await demo.still("hero", { scale: 2 });
        expect(readSize(out("stills", "hero.png"))).toEqual({ width: 2400, height: 1600 });
    });

    it("refuses an unsafe name", async () => {
        await expect(setUp().demo.still("../hero")).rejects.toThrow(/still name/);
    });

    it("keeps the film's folder free of stills", async () => {
        const { demo } = setUp();
        await demo.still("hero");
        expect(fs.existsSync(out("films"))).toBe(false);
    });
});

describe("publish and out of a still", () => {
    const optionsFile = (name: string): string => out(".owners", "still-options", `${name}.json`);
    const written = (name: string): unknown => JSON.parse(fs.readFileSync(optionsFile(name), "utf8"));

    it("records the default (published, default folder) for a still that says nothing", async () => {
        await setUp().demo.still("hero");
        expect(written("hero")).toEqual({ publish: true });
    });

    it("records publish: false, and out", async () => {
        const { demo } = setUp();
        await demo.still("phone-key", { publish: false });
        await demo.still("listing-1", { out: "listing" });
        expect(written("phone-key")).toEqual({ publish: false });
        expect(written("listing-1")).toEqual({ publish: true, out: "listing" });
    });

    it("a retake replaces what the earlier take asked for", async () => {
        const { demo } = setUp();
        await demo.still("hero", { publish: false });
        await demo.still("hero");
        expect(written("hero")).toEqual({ publish: true });
    });

    it("keeps the PNG in the stills folder whatever it asks for", async () => {
        const { demo } = setUp();
        await demo.still("a", { publish: false });
        await demo.still("b", { out: "listing" });
        expect(fs.existsSync(out("stills", "a.png"))).toBe(true);
        expect(fs.existsSync(out("stills", "b.png"))).toBe(true);
    });

    it.each([
        [{ publish: "no" }, /still "bad": publish must be true .* or false .*, got "no"/],
        [{ out: 3 }, /still "bad": out must be the name of a folder in demo\.outputs.*got 3/],
        [{ out: "a/b" }, /still "bad": out name "a\/b" is not usable as a file name/],
        [{ publish: false, out: "listing" }, /still "bad": out has no effect with publish: false/],
    ])("rejects %j before anything is written", async (value, message) => {
        const { demo } = setUp();
        await expect(demo.still("bad", value as never)).rejects.toThrow(message);
        expect(fs.existsSync(out("stills"))).toBe(false);
    });
});

describe("settle option of shots and stills", () => {
    const shotWith = async (settle?: boolean): Promise<void> => {
        const film = setUp().demo.film({ kind: "desktop" });
        await film.shot({ hold: 1, ...(settle !== undefined && { settle }) });
    };

    it("does not settle unless asked, so a loading frame filmed on purpose is taken as it is", async () => {
        await shotWith();
        await shotWith(false);
        expect(logged("settle")).toEqual([]);
        await setUp().demo.still("plain");
        expect(logged("settle")).toEqual([]);
    });

    it("settles a shot before the page is frozen", async () => {
        await shotWith(true);
        expect(fake.log.filter((entry) => ["settle", "freeze", "release"].includes(entry))).toEqual(["settle", "freeze", "release"]);
    });

    it("settles a still before the freeze, and after a preset has resized the window", async () => {
        const { demo } = setUp({
            settle: () => {
                fake.log.push(`settle@${JSON.stringify(fake.viewport)}`);
                return Promise.resolve();
            },
        });
        await demo.still("card", { preset: "social", settle: true });
        const order = fake.log.filter((entry) => entry.startsWith("settle") || entry === "freeze");
        expect(order).toEqual([`settle@${JSON.stringify({ width: 1200, height: 630, scale: 1 })}`, "freeze"]);
        expect(fs.existsSync(out("stills", "card.png"))).toBe(true);
    });

    it("writes nothing and puts the window back when settle() fails", async () => {
        const { demo } = setUp({ settle: () => Promise.reject(new Error("settle(): the page was not quiet")) });
        await expect(demo.still("card", { preset: "social", settle: true })).rejects.toThrow("settle(): the page was not quiet");
        expect(fs.existsSync(out("stills", "card.png"))).toBe(false);
        expect(fake.viewport).toEqual({ width: 1200, height: 800, scale: 1 });
        expect(logged("freeze")).toEqual([]);
        const film = setUp({ settle: () => Promise.reject(new Error("settle(): not quiet")) }).demo.film({ kind: "desktop", name: "f" });
        await expect(film.shot({ hold: 1, settle: true })).rejects.toThrow("not quiet");
        expect(manifestOf("f").frames).toHaveLength(0);
    });

    it("refuses a settle that is not a boolean", async () => {
        const { demo } = setUp();
        await expect(demo.still("x", { settle: "yes" as never })).rejects.toThrow('still "x": settle must be true or false, got "yes".');
        const film = demo.film({ kind: "desktop", name: "g" });
        await expect(film.shot({ hold: 1, settle: 1 as never })).rejects.toThrow(/frame 1: settle must be true or false, got 1/);
    });
});

function readSize(file: string): { width: number; height: number } {
    const png = fs.readFileSync(file);
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("still presets", () => {
    it.each([
        ["readme", 1000, 640],
        ["listing-desktop", 1200, 800],
        ["listing-phone", 900, 1600],
        ["social", 1200, 630],
    ] as const)("%s gives exactly %i x %i pixels", async (preset, width, height) => {
        const { demo } = setUp();
        const result = await demo.still(`p-${preset}`, { preset });
        expect(result).toMatchObject({ width, height });
        expect(readSize(result.file)).toEqual({ width, height });
    });

    it("resizes the window for the picture and puts the old size back, even when the shot fails", async () => {
        const { demo } = setUp();
        await demo.still("a", { preset: "listing-phone" });
        expect(fake.viewport).toEqual({ width: 1200, height: 800, scale: 1 });
        expect(fake.cdp.filter((c) => c.method === "Emulation.setDeviceMetricsOverride").map((c) => c.params)).toEqual([
            { width: 450, height: 800, deviceScaleFactor: 2, mobile: false },
            { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false },
        ]);
        fake.forbiddenVisible.add(".x");
        await expect(demo.still("b", { preset: "social", forbiddenSelectors: [".x"] })).rejects.toThrow(/forbidden selector/);
        expect(fake.viewport).toEqual({ width: 1200, height: 800, scale: 1 });
    });

    it("clears the override first when the page lost the one this session sent (a plain win.screenshot() drops it)", async () => {
        const session = fake.cdpSession;
        let ignoreRepeat = false;
        let last = "";
        const { demo } = setUp({
            cdp: () =>
                Promise.resolve({
                    ...session,
                    send: (method: string, params?: unknown) => {
                        // Chromium ignores a set that repeats the session's active override, until it is cleared.
                        if (method === "Emulation.clearDeviceMetricsOverride") {
                            fake.cdp.push({ method, params });
                            last = "";
                            return Promise.resolve({});
                        }
                        if (method === "Emulation.setDeviceMetricsOverride" && JSON.stringify(params) === last && ignoreRepeat) {
                            fake.cdp.push({ method, params });
                            return Promise.resolve({});
                        }
                        last = method === "Emulation.setDeviceMetricsOverride" ? JSON.stringify(params) : last;
                        return rawSend(session, method, params);
                    },
                } as typeof session),
        });
        const film = demo.film({ kind: "desktop" });
        await film.shot({ hold: 1 });
        // What win.screenshot() does to the page, behind this session's back.
        fake.viewport = { width: 1200, height: 800, scale: 1 };
        ignoreRepeat = true;
        await film.shot({ hold: 1 });
        const sent = fake.cdp.map((c) => c.method).filter((m) => m.startsWith("Emulation."));
        expect(sent).toEqual(["Emulation.setDeviceMetricsOverride", "Emulation.clearDeviceMetricsOverride", "Emulation.setDeviceMetricsOverride"]);
    });

    it("brings a phone film back to the phone size after a plain win.screenshot() dropped the override", async () => {
        const tracker = createDeviceMetricsTracker(() => Promise.resolve(fake.cdpSession));
        const { demo } = setUp({ deviceMetrics: tracker });
        // obsidian.mobile(): the layout class and the override, sent through the shared tracker.
        fake.mobile = true;
        await tracker.set({ width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
        const film = demo.film({ kind: "phone" });
        fake.cdp.length = 0;
        await film.shot({ hold: 1 });
        expect(fake.cdp.map((c) => c.method)).toEqual(["Page.captureScreenshot"]);
        // What win.screenshot() does to the page: the override is gone, the session does not know.
        fake.viewport = { width: 1200, height: 800, scale: 1 };
        fake.cdp.length = 0;
        await film.shot({ hold: 1 });
        expect(manifestOf(film.name)).toMatchObject({ width: 780, height: 1688 });
        expect(fake.viewport).toEqual({ width: 390, height: 844, scale: 2 });
        expect(fake.cdp.map((c) => c.method)).toEqual(["Emulation.clearDeviceMetricsOverride", "Emulation.setDeviceMetricsOverride", "Page.captureScreenshot"]);
    });

    it("sends no clear when the override is new or the page still has it", async () => {
        const { demo } = setUp();
        const film = demo.film({ kind: "desktop" });
        await film.shot({ hold: 1 });
        await film.shot({ hold: 1 });
        await demo.still("a", { scale: 3 });
        expect(fake.cdp.filter((c) => c.method === "Emulation.clearDeviceMetricsOverride")).toEqual([]);
    });

    it("puts the window back when the preset size never arrives, and reports that error", async () => {
        const session = fake.cdpSession;
        let overrides = 0;
        const { demo } = setUp({
            cdp: () =>
                Promise.resolve({
                    ...session,
                    send: (method: string, params?: unknown) => {
                        if (method === "Emulation.setDeviceMetricsOverride") {
                            overrides += 1;
                            fake.cdp.push({ method, params });
                            // The first override (the preset) does not take effect; the second (the restore) does.
                            if (overrides === 2) {
                                const p = params as { width: number; height: number; deviceScaleFactor: number };
                                fake.viewport = { width: p.width, height: p.height, scale: p.deviceScaleFactor };
                            }
                            return Promise.resolve({});
                        }
                        return rawSend(session, method, params);
                    },
                } as typeof session),
        });
        await expect(demo.still("a", { preset: "social" })).rejects.toThrow(/did not become 1200 x 630 at scale 1 within 555 ms/);
        expect(fake.cdp.filter((c) => c.method === "Emulation.setDeviceMetricsOverride").map((c) => c.params)).toEqual([
            { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false },
            { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false },
        ]);
        expect(fake.viewport).toEqual({ width: 1200, height: 800, scale: 1 });
    });

    it("keeps the first error when putting the window back fails as well", async () => {
        const session = fake.cdpSession;
        const { demo } = setUp({
            cdp: () =>
                Promise.resolve({
                    ...session,
                    send: (method: string, params?: unknown) => {
                        const calls = fake.cdp.filter((c) => c.method === "Emulation.setDeviceMetricsOverride").length;
                        if (method === "Emulation.setDeviceMetricsOverride") {
                            fake.cdp.push({ method, params });
                            return calls === 0 ? Promise.resolve({}) : Promise.reject(new Error("session closed"));
                        }
                        return rawSend(session, method, params);
                    },
                } as typeof session),
        });
        await expect(demo.still("a", { preset: "social" })).rejects.toThrow(
            /did not become 1200 x 630 at scale 1 .* Putting the previous size back also failed \(session closed\); the window may still be resized/s,
        );
    });

    it("keeps the shot's error when the window cannot be put back after a failed shot", async () => {
        const session = fake.cdpSession;
        let overrides = 0;
        const { demo } = setUp({
            cdp: () =>
                Promise.resolve({
                    ...session,
                    send: (method: string, params?: unknown) => {
                        if (method === "Emulation.setDeviceMetricsOverride") {
                            overrides += 1;
                            return overrides === 1 ? rawSend(session, method, params) : Promise.reject(new Error("session closed"));
                        }
                        return rawSend(session, method, params);
                    },
                } as typeof session),
        });
        fake.forbiddenVisible.add(".x");
        await expect(demo.still("b", { preset: "social", forbiddenSelectors: [".x"] })).rejects.toThrow(/forbidden selector .* Putting the window back also failed: session closed/s);
    });

    it("does not resize a window that already has the preset's size", async () => {
        const { demo } = setUp();
        await demo.still("a", { preset: "listing-desktop" });
        expect(fake.cdp.map((c) => c.method)).toEqual(["Page.captureScreenshot"]);
    });

    it("refuses a preset together with a clip or a scale, and an unknown preset", async () => {
        const { demo } = setUp();
        await expect(demo.still("a", { preset: "social", clip: { x: 0, y: 0, width: 1, height: 1 } })).rejects.toThrow(/fixes the picture size/);
        await expect(demo.still("a", { preset: "social", scale: 2 })).rejects.toThrow(/fixes the picture size/);
        await expect(demo.still("a", { preset: "poster" as never })).rejects.toThrow(/Unknown still preset/);
    });
});

describe("privacy guard", () => {
    it("refuses film() and still() when the vault came from OPDK_E2E_VAULT, before anything is written or shot", async () => {
        const { demo } = setUp({ seedVaultSource: "env", seedVault: "/home/me/real-vault" });
        expect(() => demo.film({ kind: "desktop" })).toThrow(/film "wizard-tour-pick-sports" refused: OPDK_E2E_VAULT points this run at \/home\/me\/real-vault/);
        await expect(demo.still("hero")).rejects.toThrow(/still "hero" refused/);
        expect(fs.existsSync(out())).toBe(false);
        expect(fake.cdp).toEqual([]);
    });

    it("refuses a seed vault outside the plugin folder, even from the option", async () => {
        const { demo } = setUp({ seedVault: "/elsewhere/vault" });
        expect(() => demo.film({ kind: "desktop" })).toThrow(/refused: the seed vault \/elsewhere\/vault lies outside the plugin folder \/plugin/);
        await expect(demo.still("hero")).rejects.toThrow(/still "hero" refused: the seed vault/);
        await expect(demo.still("hero", { allowForeignVault: true })).resolves.toMatchObject({ width: 2400 });
    });

    it("allows both when the spec says allowForeignVault: true", async () => {
        const { demo } = setUp({ seedVaultSource: "env" });
        const film = demo.film({ kind: "desktop", allowForeignVault: true });
        await film.shot({ hold: 1 });
        await expect(demo.still("hero", { allowForeignVault: true })).resolves.toMatchObject({ width: 2400 });
    });
});

describe("forbidden selectors", () => {
    it("fail a frame when one is visible, from the configuration or from the call, and write nothing", async () => {
        fake.forbiddenVisible.add(".api-key");
        const { demo } = setUp({ options: resolveDemoOptions({ outDir: "out", forbiddenSelectors: [".api-key"] }, root) });
        const film = demo.film({ kind: "desktop" });
        await expect(film.shot({ hold: 1 })).rejects.toThrow(/film "wizard-tour-pick-sports", frame 1 refused: .*forbidden selector ".api-key" is visible/);
        expect(fs.readdirSync(film.dir).sort()).toEqual(["manifest.json", "owner.json"]);
        expect(fake.cdp.filter((c) => c.method === "Page.captureScreenshot")).toEqual([]);

        fake.forbiddenVisible.add("#token");
        await expect(demo.still("s", { forbiddenSelectors: ["#token"] })).rejects.toThrow(/still "s" refused: .*"\.api-key"/);
    });

    it("pass when none is visible, and the per-call ones add to the configured ones", async () => {
        const { demo } = setUp({ options: resolveDemoOptions({ outDir: "out", forbiddenSelectors: [".a"] }, root) });
        await demo.still("s", { forbiddenSelectors: [".b"] });
        expect(logged("count:")).toEqual(["count:.a:true", "count:.b:true"]);
    });
});

describe("themes", () => {
    it("runs the scene once per theme in order and suffixes film and still names", async () => {
        const { demo } = setUp();
        const seen: string[] = [];
        await demo.themes(["light", "dark"], async (mode) => {
            const film = demo.film({ kind: "desktop", name: "tour" });
            await film.shot({ hold: 1 });
            await demo.still("hero");
            seen.push(`${mode}:${film.name}`);
        });
        expect(themes).toEqual(["light", "dark"]);
        expect(seen).toEqual(["light:tour-light", "dark:tour-dark"]);
        expect(manifestOf("tour-light").theme).toBe("light");
        expect(manifestOf("tour-dark").theme).toBe("dark");
        expect(fs.readdirSync(out("stills")).sort()).toEqual(["hero-dark.png", "hero-light.png"]);
        // After the scene the names are plain again.
        expect(demo.film({ kind: "desktop", name: "tour" }).name).toBe("tour");
    });

    it("is not nested, needs real modes once each, and still resets the suffix when the scene throws", async () => {
        const { demo } = setUp();
        await expect(demo.themes([], () => Promise.resolve())).rejects.toThrow(/pass "light", "dark" or both/);
        await expect(demo.themes(["light", "light"], () => Promise.resolve())).rejects.toThrow(/each once/);
        await expect(demo.themes(["blue" as never], () => Promise.resolve())).rejects.toThrow(/pass "light"/);
        await expect(demo.themes(["light"], () => demo.themes(["dark"], () => Promise.resolve()))).rejects.toThrow(/cannot be nested/);
        await expect(
            demo.themes(["dark"], () => {
                throw new Error("scene failed");
            }),
        ).rejects.toThrow("scene failed");
        expect(demo.film({ kind: "desktop", name: "plain" }).name).toBe("plain");
    });
});

describe("finishing", () => {
    it("marks the films of a passed test complete, and leaves a failed test's films incomplete", async () => {
        const passed = setUp();
        const film = passed.demo.film({ kind: "desktop", name: "ok" });
        passed.demo.film({ kind: "desktop", name: "empty" });
        await film.shot({ hold: 1 });
        passed.finish({ status: "passed" });
        expect(manifestOf("ok").complete).toBe(true);
        expect(manifestOf("empty").complete).toBe(false);

        const failed = setUp();
        const half = failed.demo.film({ kind: "desktop", name: "half" });
        await half.shot({ hold: 1 });
        failed.finish({ status: "failed" });
        expect(manifestOf("half").complete).toBe(false);
    });

    it.each(["timedOut", "skipped", "interrupted", undefined])("leaves the films incomplete for the status %s", async (status) => {
        const controller = setUp();
        const film = controller.demo.film({ kind: "desktop", name: "unfinished" });
        await film.shot({ hold: 1 });
        controller.finish({ status });
        expect(manifestOf("unfinished").complete).toBe(false);
    });

    it("a test.fail() test that fails as expected still has an incomplete film: only the status passed completes", async () => {
        // Playwright reports status "failed" with expectedStatus "failed"; the kit looks at the status alone.
        const controller = setUp();
        const film = controller.demo.film({ kind: "desktop", name: "expected-failure" });
        await film.shot({ hold: 1 });
        controller.finish({ status: "failed" });
        expect(manifestOf("expected-failure").complete).toBe(false);
    });
});

describe("pointer helpers", () => {
    it("moveAndClick sets the cursor, moves to the centre in steps and clicks", async () => {
        fake.visible.set("#go", { x: 100, y: 200, width: 40, height: 20 });
        await setUp().demo.moveAndClick(target("#go"));
        expect(fake.log.filter((e) => e.startsWith("overlay:") || e.startsWith("mouse") || e.startsWith("click"))).toEqual([
            'overlay:{"method":"pointer","arg":"cursor"}',
            "mouse.move:120,210:14",
            "click:#go",
        ]);
    });

    it("moveAndClick and tap fail on a missing target instead of logging", async () => {
        const { demo } = setUp();
        await expect(demo.moveAndClick(target("#nope"))).rejects.toThrow(/moveAndClick\(\): locator\('#nope'\) was not visible within 555 ms/);
        await expect(demo.tap(target("#nope"))).rejects.toThrow(/tap\(\): locator\('#nope'\) was not visible/);
        expect(logged("click:")).toEqual([]);
        expect(logged("mouse.down")).toEqual([]);
    });

    it("moveAndClick fails when the visible target has no box", async () => {
        fake.visible.set("#go", { x: 0, y: 0, width: 1, height: 1 });
        const locator = { ...target("#go"), boundingBox: () => Promise.resolve(null) } as unknown as Locator;
        await expect(setUp().demo.moveAndClick(locator)).rejects.toThrow(/has no bounding box/);
    });

    it("tap hovers the target, presses, runs the callback while pressed, then releases", async () => {
        fake.visible.set("#next", { x: 0, y: 0, width: 10, height: 10 });
        await setUp().demo.tap(target("#next"), {
            whilePressed: () => {
                fake.log.push("shot while pressed");
                return Promise.resolve();
            },
        });
        expect(fake.log.filter((e) => e.startsWith("overlay:") || e.startsWith("hover") || e.startsWith("mouse") || e.startsWith("shot"))).toEqual([
            'overlay:{"method":"pointer","arg":"tap"}',
            "hover:#next",
            "mouse.down",
            "shot while pressed",
            "mouse.up",
            'overlay:{"method":"hidePointer","arg":null}',
        ]);
    });

    it("tap releases the mouse and hides the dot even when the callback fails, and reports the callback's error", async () => {
        fake.visible.set("#next", { x: 0, y: 0, width: 10, height: 10 });
        await expect(
            setUp().demo.tap(target("#next"), {
                whilePressed: () => Promise.reject(new Error("frame failed")),
            }),
        ).rejects.toThrow("frame failed");
        expect(fake.log.filter((e) => e.startsWith("mouse") || e.includes("hidePointer"))).toEqual(["mouse.down", "mouse.up", 'overlay:{"method":"hidePointer","arg":null}']);
    });

    it("tap works without a callback", async () => {
        fake.visible.set("#next", { x: 0, y: 0, width: 10, height: 10 });
        await setUp().demo.tap(target("#next"));
        expect(logged("mouse")).toEqual(["mouse.down", "mouse.up"]);
        expect(logged("overlay:").at(-1)).toBe('overlay:{"method":"hidePointer","arg":null}');
    });

    it("fails when the overlay is missing from the document", async () => {
        fake.overlayPresent = false;
        await expect(setUp().demo.caption("x")).rejects.toThrow(/overlay is missing from this document \(caption\)/);
    });

    it("caption and hideCursor drive the overlay", async () => {
        const { demo } = setUp();
        await demo.caption("Hello");
        await demo.caption(null);
        await demo.hideCursor();
        expect(logged("overlay:")).toEqual([
            'overlay:{"method":"caption","arg":"Hello"}',
            'overlay:{"method":"caption","arg":null}',
            'overlay:{"method":"hidePointer","arg":null}',
        ]);
    });
});

describe("typeSlowly", () => {
    it("types into the focused element when given only text", async () => {
        await setUp().demo.typeSlowly("hello", { delayMs: 10 });
        expect(logged("keyboard.type")).toEqual(["keyboard.type:hello:10"]);
    });

    it("fails without a target when nothing editable has focus, and types nothing", async () => {
        fake.editableFocus = false;
        await expect(setUp().demo.typeSlowly("hello")).rejects.toThrow(/typeSlowly\(text\): nothing editable has focus.*typeSlowly\(locator, text\)/);
        expect(logged("keyboard.type")).toEqual([]);
    });

    it("does not need focus when it has a target: it clicks the target first", async () => {
        fake.editableFocus = false;
        fake.visible.set("#editor", { x: 0, y: 0, width: 10, height: 10 });
        await setUp().demo.typeSlowly(target("#editor"), "ab");
        expect(logged("pressSequentially")).toHaveLength(1);
    });

    it("clicks the target with the cursor first, then types with a budget that grows with the text", async () => {
        fake.visible.set("#editor", { x: 0, y: 0, width: 100, height: 100 });
        await setUp().demo.typeSlowly(target("#editor"), "abcd");
        expect(logged("click:")).toEqual(["click:#editor"]);
        // 555 ms for the target + 4 keys at (40 ms delay + 50 ms slack).
        expect(logged("pressSequentially")).toEqual(["pressSequentially:#editor:abcd:40:915"]);
    });

    it("fails on a missing target, a bad delay and bad arguments", async () => {
        const { demo } = setUp();
        await expect(demo.typeSlowly(target("#nope"), "x")).rejects.toThrow(/moveAndClick\(\): locator/);
        await expect(demo.typeSlowly("x", { delayMs: -1 })).rejects.toThrow(/delayMs must be/);
        await expect(demo.typeSlowly(target("#nope"), 3 as never)).rejects.toThrow(/pass the text/);
        await expect(demo.typeSlowly("x", "y" as never)).rejects.toThrow(/pass the text/);
    });
});

describe("beat", () => {
    it("waits the given seconds", async () => {
        await setUp().demo.beat(1.5);
        expect(logged("waitForTimeout")).toEqual(["waitForTimeout:1500"]);
    });

    it("refuses more than 60 seconds, with a hint about milliseconds", async () => {
        await expect(setUp().demo.beat(1500)).rejects.toThrow(/1500 seconds is more than 60. beat\(\) takes seconds, not milliseconds .* did you mean beat\(1.5\)\?/);
        await expect(setUp().demo.beat(60)).resolves.toBeUndefined();
        expect(logged("waitForTimeout")).toEqual(["waitForTimeout:60000"]);
    });

    it("refuses a negative or non-finite pause", async () => {
        await expect(setUp().demo.beat(-1)).rejects.toThrow(/seconds must be/);
        await expect(setUp().demo.beat(Number.NaN)).rejects.toThrow(/seconds must be/);
    });
});

describe("cleanUi", () => {
    it("hides everything by default: Obsidian settings for three parts, the page classes for two, and folds the sidebars", async () => {
        await setUp().demo.cleanUi();
        expect(logged("ui:")).toEqual(['ui:{"showRibbon":false,"showViewHeader":false,"showInlineTitle":false}']);
        expect(logged("overlay:")).toEqual(['overlay:{"method":"clean","arg":{"statusBar":true,"tabHeaders":true}}']);
        expect(sidebarCalls).toBe(1);
        expect(fake.log.indexOf("collapseSidebars")).toBeGreaterThan(fake.log.findIndex((e) => e.startsWith("overlay:")));
    });

    it("leaves the sidebars alone with sidebars: false, and folds them again on the next default call", async () => {
        const { demo } = setUp();
        await demo.cleanUi({ sidebars: false });
        expect(sidebarCalls).toBe(0);
        await demo.cleanUi({ sidebars: true });
        await demo.cleanUi();
        expect(sidebarCalls).toBe(2);
    });

    it("does not fold the sidebars when the call is refused, and passes on a failure of the fold", async () => {
        const { demo } = setUp();
        await expect(demo.cleanUi({ sidebars: "no" as never })).rejects.toThrow(/sidebars must be true \(hide\) or false \(show\)/);
        expect(sidebarCalls).toBe(0);
        const failing = setUp({ collapseSidebars: () => Promise.reject(new Error("collapseSidebars(): this Obsidian has no workspace.leftSplit")) });
        await expect(failing.demo.cleanUi()).rejects.toThrow("no workspace.leftSplit");
    });

    it("keeps what is set to false, and each call decides everything", async () => {
        const { demo } = setUp();
        await demo.cleanUi({ ribbon: false, statusBar: false });
        await demo.cleanUi({ tabHeaders: false });
        expect(logged("ui:")).toEqual([
            'ui:{"showRibbon":true,"showViewHeader":false,"showInlineTitle":false}',
            'ui:{"showRibbon":false,"showViewHeader":false,"showInlineTitle":false}',
        ]);
        expect(logged("overlay:")).toEqual([
            'overlay:{"method":"clean","arg":{"statusBar":false,"tabHeaders":true}}',
            'overlay:{"method":"clean","arg":{"statusBar":true,"tabHeaders":false}}',
        ]);
    });

    it("rejects an unknown or non-boolean option", async () => {
        const { demo } = setUp();
        await expect(demo.cleanUi({ titlebar: true } as never)).rejects.toThrow(/unknown option "titlebar". Known options: ribbon, statusBar.*sidebars/);
        await expect(demo.cleanUi({ ribbon: "yes" as never })).rejects.toThrow(/ribbon must be true \(hide\) or false \(show\)/);
    });
});

describe("freezeTime", () => {
    it("fixes the clock with setFixedTime", async () => {
        await setUp().demo.freezeTime(new Date("2026-03-14T09:26:00Z"));
        expect(logged("setFixedTime")).toEqual(["setFixedTime:2026-03-14T09:26:00.000Z"]);
    });

    it("takes a string or a timestamp", async () => {
        const { demo } = setUp();
        await demo.freezeTime(0);
        await demo.freezeTime("2026-01-01T00:00:00Z");
        expect(logged("setFixedTime")).toEqual(["setFixedTime:1970-01-01T00:00:00.000Z", "setFixedTime:2026-01-01T00:00:00.000Z"]);
    });

    it("rejects what is not a date", async () => {
        await expect(setUp().demo.freezeTime("tomorrow-ish")).rejects.toThrow(/tomorrow-ish is not a date/);
        expect(logged("setFixedTime")).toEqual([]);
    });
});

describe("names shared by tests of one run", () => {
    const other = { testId: "t-2", title: "Other test", file: "e2e/other.spec.ts" };

    it("refuses a second test's film of the same name in the same run, naming the first test, and keeps the first film", async () => {
        const first = setUp();
        const film = first.demo.film({ kind: "desktop", name: "tour" });
        await film.shot({ hold: 1 });
        const second = setUp({ source: other });
        expect(() => second.demo.film({ kind: "desktop", name: "tour" })).toThrow(
            /film "tour" was already written in this run by another test \("Wizard tour: pick sports"\).*pass a different name/s,
        );
        expect(manifestOf("tour").frames).toHaveLength(1);
        expect(fs.existsSync(path.join(film.dir, "0001.png"))).toBe(true);
    });

    it("refuses a second test's still of the same name in the same run and leaves the first picture", async () => {
        await setUp().demo.still("hero");
        const before = fs.readFileSync(out("stills", "hero.png"));
        fake.cdp.length = 0;
        await expect(setUp({ source: other }).demo.still("hero", { scale: 1 })).rejects.toThrow(/still "hero" was already written in this run by another test/);
        expect(fake.cdp).toEqual([]);
        expect(fs.readFileSync(out("stills", "hero.png")).equals(before)).toBe(true);
    });

    it("lets the same test write the name again (a retry), and a later run replace it", async () => {
        const first = setUp();
        first.demo.film({ kind: "desktop", name: "tour" });
        await first.demo.still("hero");
        expect(() => setUp().demo.film({ kind: "desktop", name: "tour" })).not.toThrow();
        await expect(setUp().demo.still("hero")).resolves.toBeDefined();
        expect(() => setUp({ source: other, runId: "run-2" }).demo.film({ kind: "desktop", name: "tour" })).not.toThrow();
        await expect(setUp({ source: other, runId: "run-3" }).demo.still("hero")).resolves.toBeDefined();
    });

    it("different names do not clash, and a damaged marker does not block", () => {
        setUp().demo.film({ kind: "desktop", name: "a" });
        expect(() => setUp({ source: other }).demo.film({ kind: "desktop", name: "b" })).not.toThrow();
        fs.writeFileSync(out("films", "a", "owner.json"), "{not json");
        expect(() => setUp({ source: other }).demo.film({ kind: "desktop", name: "a" })).not.toThrow();
    });

    it("writes the owner marker into the film folder and one per still", async () => {
        const { demo } = setUp();
        demo.film({ kind: "desktop", name: "tour" });
        await demo.still("hero");
        expect(JSON.parse(fs.readFileSync(out("films", "tour", "owner.json"), "utf8"))).toEqual({ testId: "t-1", runId: "run-1", title: "Wizard tour: pick sports" });
        expect(JSON.parse(fs.readFileSync(out(".owners", "stills", "hero.json"), "utf8"))).toEqual({ testId: "t-1", runId: "run-1", title: "Wizard tour: pick sports" });
    });
});

/**
 * The live end-to-end of `opdk demo`: records a short desktop film and a phone film with captions in the real
 * Obsidian, then encodes them with the real ffmpeg (and, for the phone film, the real Electron) and checks the
 * files. Skipped unless `OPDK_E2E_DEMO_MEDIA=1`; it needs ffmpeg and ffprobe on PATH. Everything is written into a
 * temp folder that the spec removes afterwards
 * (`OPDK_E2E_DEMO_KEEP=1` keeps it).
 *
 * The last test runs `runDemo` in this process, with the same config the CLI would load from `opdk.config.mjs`.
 * It must be the last: a film is complete only when its own test has finished.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createObsidianTest, parseFilmManifest } from "../../../src/e2e/index.js";
import { readPngSize } from "../../../src/e2e/demo/png.js";
import { validateDemoConfig } from "../../../src/demo/config.js";
import { defaultDeps, runDemo } from "../../../src/demo/run.js";
import { createReporter } from "../../../src/cli/reporter.js";
import { FIXTURE_ID, SECOND_ID, SEED_VAULT } from "./fixtures.js";

const root = path.join(import.meta.dirname, "..");
const repo = path.join(root, "..", "..");
const BASE = path.join(os.tmpdir(), `opdk-demo-media-${String(process.pid)}`);
const OUT_DIR = path.join(BASE, "demo");
const OUTPUT = path.join(BASE, "media");
const EDITOR = '.workspace-leaf-content[data-type="markdown"] .cm-content[contenteditable=true]';

const { test, expect, onlyWhen } = createObsidianTest({
    seedVault: SEED_VAULT,
    plugins: [{ dir: path.join(root, "plugins", FIXTURE_ID) }, { dir: path.join(root, "plugins", SECOND_ID) }],
    window: { width: 1200, height: 800 },
    demo: { outDir: OUT_DIR },
});

onlyWhen("OPDK_E2E_DEMO_MEDIA");

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
    // OPDK_E2E_DEMO_KEEP=1 leaves the films and the finished media for a look; the path is printed.
    if (process.env.OPDK_E2E_DEMO_KEEP === "1") {
        console.log(`[demo-media] kept ${BASE}`);
        return;
    }
    fs.rmSync(BASE, { recursive: true, force: true });
});

test("record a desktop film", async ({ obsidian, demo, win }) => {
    await obsidian.openFile("Welcome.md", { mode: "source" });
    await demo.cleanUi();
    await obsidian.collapseSidebars();
    await obsidian.clearNotices();
    const editor = win.locator(EDITOR).first();
    const film = demo.film({ kind: "desktop", name: "tour-desktop", fps: 10 });
    await film.shot({ hold: 1 });
    await demo.moveAndClick(editor);
    await demo.typeSlowly(editor, "\nA line typed for the film", { delayMs: 10 });
    await expect(editor).toContainText("A line typed for the film");
    await demo.caption("Typing into the note");
    await film.shot({ hold: 1.5 });
    await film.shot({ hold: 0.5 });
});

test("record a phone film with captions, one of them with markup in it", async ({ obsidian, demo, win }) => {
    await obsidian.mobile();
    await obsidian.openFile("Welcome.md");
    const film = demo.film({ kind: "phone", name: "tour-phone", fps: 10, captions: ["Open the <note> & read it", "Tap the editor\nA heading and a text", "Done"] });
    await film.shot({ hold: 1, caption: 0 });
    await demo.tap(win.locator(EDITOR).first());
    await film.shot({ hold: 1, caption: 1 });
    await film.shot({ hold: 1, caption: 2 });
});

test("opdk demo turns both films into MP4, GIF and poster", async () => {
    test.setTimeout(180_000);
    const lines: string[] = [];
    const reporter = createReporter({
        stdout: (text) => lines.push(text),
        stderr: (text) => lines.push(text),
        colorStdout: false,
        colorStderr: false,
    });
    // The config a plugin would write: the phone film gets the caption layout, the desktop one stays plain.
    const config = validateDemoConfig(
        { outDir: OUT_DIR, output: OUTPUT, loop: "off", films: { "tour-phone": { layout: "phone-captions" } }, phone: { title: "Tour <of> the kit" } },
        "demo-media.spec.ts",
    );
    const code = await runDemo({ cwd: repo, env: process.env, names: [], config, reporter, source: "demo-media.spec.ts", deps: defaultDeps });
    expect(lines.join("")).toMatch(/✓ demo +tour-desktop: mp4 \d+ KB, gif \d+ KB, poster/);
    expect(lines.join("")).toMatch(/✓ demo +tour-phone: mp4 \d+ KB, gif \d+ KB, poster/);
    expect(code).toBe(0);
    expect(fs.readdirSync(OUTPUT).sort()).toEqual([
        "tour-desktop-poster.png",
        "tour-desktop.gif",
        "tour-desktop.mp4",
        "tour-phone-poster.png",
        "tour-phone.gif",
        "tour-phone.mp4",
    ]);

    const desktop = parseFilmManifest(fs.readFileSync(path.join(OUT_DIR, "films", "tour-desktop", "manifest.json"), "utf8"));
    expect(desktop).toMatchObject({ width: 2400, height: 1600, complete: true });
    expect(videoSize(path.join(OUTPUT, "tour-desktop.mp4"))).toEqual({ width: 2400, height: 1600 });
    expect(gifSize(path.join(OUTPUT, "tour-desktop.gif"))).toEqual({ width: 1000, height: 667 });
    // The poster is as sharp as the MP4.
    expect(readPngSize(fs.readFileSync(path.join(OUTPUT, "tour-desktop-poster.png")))).toEqual({ width: 2400, height: 1600 });

    // The phone film is composed into the 1000 x 620 page at 2x.
    expect(videoSize(path.join(OUTPUT, "tour-phone.mp4"))).toEqual({ width: 2000, height: 1240 });
    expect(gifSize(path.join(OUTPUT, "tour-phone.gif"))).toEqual({ width: 1000, height: 620 });
    expect(readPngSize(fs.readFileSync(path.join(OUTPUT, "tour-phone-poster.png")))).toEqual({ width: 2000, height: 1240 });
    expect(Number(probe(path.join(OUTPUT, "tour-phone.mp4"), "format=duration"))).toBeGreaterThan(2.8);
});

function probe(file: string, entries: string): string {
    return execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "csv=p=0:s=x", file], { encoding: "utf8" }).trim();
}

function videoSize(file: string): { width: number; height: number } {
    const [width, height] = probe(file, "stream=width,height").split("x").map(Number);
    return { width: width ?? 0, height: height ?? 0 };
}

/** A GIF's logical screen size is in its header: width and height as 16-bit little-endian numbers after "GIF89a". */
function gifSize(file: string): { width: number; height: number } {
    const header = fs.readFileSync(file).subarray(0, 10);
    return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
}

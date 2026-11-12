import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPngSize } from "../e2e/demo/png.js";
import { BLUE, RED, writeFilm } from "../test-support/demo-films.js";
import { testTmpRoot } from "../test-support/test-tmp.js";
import { composePhoneFrames, withTimeout } from "./phone-render.js";
import { resolvePhoneLayout } from "./phone-layout.js";

// A real Electron window (hidden), launched through Playwright: seconds, not milliseconds.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });

let dir: string;
/** The render's own temp base: asserting on it cannot be disturbed by other tests that use the shared temp folder. */
let tmp: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-demo-render-"));
    tmp = fs.mkdtempSync(path.join(testTmpRoot(), "opdk-render-tmp-"));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe("composePhoneFrames", () => {
    it("renders each frame into a 2000 x 1240 page with the captions beside the phone, and cleans up", async () => {
        const manifest = writeFilm(dir, {
            name: "phone",
            kind: "phone",
            width: 390,
            height: 780,
            captions: ["Open <the> note", "Tap it"],
            frames: [
                { hold: 1, caption: 0, background: RED },
                { hold: 1, caption: 1, background: BLUE },
            ],
        });
        const outDir = path.join(dir, "composed");
        await composePhoneFrames({
            cwd: process.cwd(),
            filmDir: path.join(dir, "films", "phone"),
            frames: manifest.frames,
            captions: manifest.captions,
            layout: resolvePhoneLayout([{ title: "A <b>tour</b>" }], null),
            outDir,
            tmpDir: tmp,
        });

        const first = fs.readFileSync(path.join(outDir, "0001.png"));
        const second = fs.readFileSync(path.join(outDir, "0002.png"));
        expect(readPngSize(first)).toEqual({ width: 2000, height: 1240 });
        expect(readPngSize(second)).toEqual({ width: 2000, height: 1240 });
        // The phone picture (red, then blue) and the highlighted step differ between the frames.
        expect(first.equals(second)).toBe(false);
        // Nothing of the render is left behind.
        expect(fs.readdirSync(tmp)).toEqual([]);
    });

    it("draws the caption: the same picture with another step highlighted gives another frame, and the same step the same frame", async () => {
        const manifest = writeFilm(dir, {
            name: "phone",
            kind: "phone",
            width: 390,
            height: 780,
            captions: ["Open the note", "Tap it"],
            frames: [
                { hold: 1, caption: 0, background: RED },
                { hold: 1, caption: 1, background: RED },
                { hold: 1, caption: 1, background: RED },
            ],
        });
        const outDir = path.join(dir, "composed");
        await composePhoneFrames({
            cwd: process.cwd(),
            filmDir: path.join(dir, "films", "phone"),
            frames: manifest.frames,
            captions: manifest.captions,
            layout: resolvePhoneLayout([], null),
            outDir,
            tmpDir: tmp,
        });
        const [one, two, three] = ["0001.png", "0002.png", "0003.png"].map((file) => fs.readFileSync(path.join(outDir, file)));
        expect(one?.equals(two ?? Buffer.alloc(0))).toBe(false);
        expect(two?.equals(three ?? Buffer.alloc(0))).toBe(true);
    });

    it("checks the Playwright and Electron versions before rendering", async () => {
        await expect(
            composePhoneFrames({
                cwd: dir,
                filmDir: dir,
                frames: [],
                captions: [],
                layout: resolvePhoneLayout([], null),
                outDir: path.join(dir, "out"),
                tmpDir: tmp,
                readVersion: (name) => (name === "electron" ? "30.0.0" : undefined),
            }),
        ).rejects.toThrow(/layout "phone-captions": "@playwright\/test" is not installed.*"electron" 30\.0\.0 is installed.*Run: npm install --save-dev @playwright\/test@\^1\.62\.0 "electron@>=39\.0\.0"/s);
        expect(fs.readdirSync(tmp)).toEqual([]);
    });

    it("says what to install when the plugin has no electron", async () => {
        await expect(
            composePhoneFrames({
                cwd: dir,
                filmDir: dir,
                frames: [],
                captions: [],
                layout: resolvePhoneLayout([], null),
                outDir: path.join(dir, "out"),
                tmpDir: tmp,
                readVersion: (name) => (name === "electron" ? "39.0.0" : "1.62.0"),
            }),
        ).rejects.toThrow(/layout "phone-captions" renders its frames in Electron.*Cannot find the "electron" package from .*npm install --save-dev electron/s);
    });
});

describe("withTimeout", () => {
    it("passes the result and the error of work that finishes in time", async () => {
        await expect(withTimeout(Promise.resolve(7), 1000, "work")).resolves.toBe(7);
        await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "work")).rejects.toThrow("boom");
    });

    it("rejects with what hung when the work does not finish", async () => {
        await expect(withTimeout(new Promise<never>(() => undefined), 50, "Taking the screenshot")).rejects.toThrow(
            /Taking the screenshot did not finish in 0\.05 s; the Electron window is stuck/,
        );
    });
});

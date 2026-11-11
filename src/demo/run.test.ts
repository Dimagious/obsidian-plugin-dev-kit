import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPngSize } from "../e2e/demo/png.js";
import { fakePng } from "../test-support/demo-fakes.js";
import { BLUE, GREEN, RED, writeFilm, type TestFilm } from "../test-support/demo-films.js";
import { hasTool, realToolsGate } from "../test-support/ffmpeg-gate.js";
import { createContext, type CapturedContext } from "../test-support/plugin-fixture.js";
import { testTmpRoot } from "../test-support/test-tmp.js";
import type { DemoConfig } from "../config/types.js";
import { resolvePhoneLayout, type PhoneLayout } from "./phone-layout.js";
import { defaultDeps, pairWarnings, runDemo, type DemoDeps } from "./run.js";
import type { FfmpegTool } from "./ffmpeg-run.js";

vi.setConfig({ testTimeout: 60_000 });

let cwd: string;
let outDir: string;
let ctx: CapturedContext;
/** The run's own temp base: what the run leaves in it can be asserted without looking at the shared temp folder. */
let privateTmp: string;
beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-demo-run-"));
    privateTmp = fs.mkdtempSync(path.join(testTmpRoot(), "opdk-run-tmp-"));
    outDir = path.join(cwd, ".opdk", "demo");
    ctx = createContext(cwd);
});
afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(privateTmp, { recursive: true, force: true });
});

const out = (): string => ctx.out.join("");
const err = (): string => ctx.err.join("");
const media = (): string[] => (fs.existsSync(path.join(cwd, "docs", "screens")) ? fs.readdirSync(path.join(cwd, "docs", "screens")).sort() : []);

function film(overrides: Partial<TestFilm> & { name: string }): TestFilm {
    return {
        width: 200,
        height: 100,
        frames: [
            { hold: 1, background: RED },
            { hold: 0.5, background: BLUE },
            { hold: 1, background: RED },
        ],
        ...overrides,
    };
}

function run(options: { names?: string[]; config?: DemoConfig; deps?: DemoDeps; env?: Record<string, string> } = {}): Promise<number> {
    return runDemo({
        cwd,
        env: options.env ?? {},
        names: options.names ?? [],
        config: options.config ?? {},
        reporter: ctx.reporter,
        source: 'opdk.config.mjs "demo" section',
        tmpDir: privateTmp,
        ...(options.deps !== undefined && { deps: options.deps }),
    });
}

/** Records every ffmpeg call; "encodes" by writing `bytes` to the last argument, and answers raw-frame requests from `raw`. */
function fakeFfmpeg(options: { bytes?: (file: string) => number; fail?: (args: readonly string[]) => string | undefined; raw?: (file: string) => Buffer } = {}): {
    tool: FfmpegTool;
    runs: string[][];
    captures: string[][];
} {
    const runs: string[][] = [];
    const captures: string[][] = [];
    const tool: FfmpegTool = {
        command: "fake-ffmpeg",
        run: (args) => {
            runs.push([...args]);
            const message = options.fail?.(args);
            const file = args.at(-1) ?? "";
            if (message !== undefined) {
                fs.writeFileSync(file, "partial");
                return Promise.reject(new Error(message));
            }
            fs.writeFileSync(file, Buffer.alloc(options.bytes?.(file) ?? 1024));
            return Promise.resolve();
        },
        capture: (args) => {
            captures.push([...args]);
            const file = args[args.indexOf("-i") + 1] ?? "";
            return Promise.resolve(options.raw?.(file) ?? Buffer.alloc(200 * 100 * 4));
        },
        encoders: () => Promise.resolve("V..... libx264"),
    };
    return { tool, runs, captures };
}

function depsWith(tool: FfmpegTool, compose?: DemoDeps["compose"]): DemoDeps {
    return { locateFfmpeg: () => Promise.resolve(tool), compose: compose ?? (() => Promise.reject(new Error("compose must not run"))) };
}

describe("choosing films", () => {
    it("fails when there are no films at all, saying how to record them", async () => {
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(1);
        expect(err()).toContain("no films in");
        expect(err()).toContain("npx playwright test");
        expect(media()).toEqual([]);
    });

    it("fails for a name that is not a film and lists the ones there are", async () => {
        writeFilm(outDir, film({ name: "tour" }));
        expect(await run({ names: ["tuor"], deps: depsWith(fakeFfmpeg().tool) })).toBe(1);
        expect(err()).toContain('no film named "tuor"');
        expect(err()).toContain("Films there: tour");
    });

    it("encodes only the named films", async () => {
        writeFilm(outDir, film({ name: "a" }));
        writeFilm(outDir, film({ name: "b" }));
        const ffmpeg = fakeFfmpeg();
        expect(await run({ names: ["b"], deps: depsWith(ffmpeg.tool) })).toBe(0);
        expect(media()).toEqual(["b-poster.png", "b.gif", "b.mp4"]);
    });

    it("lists an incomplete film with the reason and encodes the rest; exit 0", async () => {
        writeFilm(outDir, film({ name: "good" }));
        writeFilm(outDir, film({ name: "half", complete: false }));
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(0);
        expect(out()).toMatch(/! demo +half: skipped, its recording did not finish/);
        expect(out()).toMatch(/✓ demo +good: /);
        expect(media().filter((file) => file.startsWith("half"))).toEqual([]);
    });

    it("fails when an incomplete film is asked for by name", async () => {
        writeFilm(outDir, film({ name: "half", complete: false }));
        expect(await run({ names: ["half"], deps: depsWith(fakeFfmpeg().tool) })).toBe(1);
        expect(err()).toMatch(/✗ demo +half: not encoded/);
        expect(err()).toContain("its recording did not finish");
    });

    it("fails on a manifest it cannot read and still encodes the others", async () => {
        writeFilm(outDir, film({ name: "good" }));
        fs.mkdirSync(path.join(outDir, "films", "bad"), { recursive: true });
        fs.writeFileSync(path.join(outDir, "films", "bad", "manifest.json"), "{");
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(1);
        expect(err()).toMatch(/✗ demo +bad: unusable manifest/);
        expect(out()).toMatch(/✓ demo +good: /);
    });

    it("uses demo.outDir and demo.output from the config", async () => {
        const custom = path.join(cwd, "frames");
        writeFilm(custom, film({ name: "a" }));
        expect(await run({ config: { outDir: "frames", output: "site/media" }, deps: depsWith(fakeFfmpeg().tool) })).toBe(0);
        expect(fs.readdirSync(path.join(cwd, "site", "media")).sort()).toEqual(["a-poster.png", "a.gif", "a.mp4"]);
    });
});

describe("preflight", () => {
    it("stops before any work when ffmpeg cannot be located", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const deps: DemoDeps = { locateFfmpeg: () => Promise.reject(new Error("ffmpeg was not found on PATH. Install ffmpeg")), compose: () => Promise.resolve() };
        await expect(run({ deps })).rejects.toThrow("ffmpeg was not found on PATH. Install ffmpeg");
        expect(fs.existsSync(path.join(cwd, "docs"))).toBe(false);
    });

    it("asks for the MP4 encoder only when some film makes an MP4", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const asked: boolean[] = [];
        const deps: DemoDeps = {
            locateFfmpeg: (_env, needsMp4) => {
                asked.push(needsMp4);
                return Promise.resolve(fakeFfmpeg().tool);
            },
            compose: () => Promise.resolve(),
        };
        await run({ deps });
        await run({ deps, config: { mp4: false } });
        expect(asked).toEqual([true, false]);
    });

    it("the default preflight reports a missing libx264 with the way out", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-demo-bin-"));
        try {
            // A script that answers `-version` and lists no encoders stands in for an ffmpeg built without x264.
            const script = path.join(dir, "ffmpeg");
            fs.writeFileSync(script, '#!/bin/sh\nif [ "$2" = "-encoders" ]; then echo "V..... mpeg4"; else echo "ffmpeg version fake"; fi\n', { mode: 0o755 });
            await expect(defaultDeps.locateFfmpeg({ OPDK_FFMPEG: script }, true)).rejects.toThrow(/has no libx264 encoder.*"mp4: false"/s);
            await expect(defaultDeps.locateFfmpeg({ OPDK_FFMPEG: script }, false)).resolves.toMatchObject({ command: script });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("the default preflight explains a missing ffmpeg", async () => {
        await expect(defaultDeps.locateFfmpeg({ OPDK_FFMPEG: path.join(cwd, "none") }, true)).rejects.toThrow(/OPDK_FFMPEG=.* cannot run/);
    });
});

describe("settings reach ffmpeg", () => {
    it("applies per-film and theme-pair overrides to the encodes", async () => {
        writeFilm(outDir, film({ name: "tour-light", theme: "light" }));
        writeFilm(outDir, film({ name: "tour-dark", theme: "dark" }));
        writeFilm(outDir, film({ name: "other" }));
        const ffmpeg = fakeFfmpeg();
        const config: DemoConfig = { films: { tour: { gif: { width: 120, colors: 64, fps: 5 }, mp4: false, poster: false } } };
        expect(await run({ config, deps: depsWith(ffmpeg.tool) })).toBe(0);
        expect(media()).toEqual(["other-poster.png", "other.gif", "other.mp4", "tour-dark.gif", "tour-light.gif"]);
        const gifs = ffmpeg.runs.filter((args) => args.at(-1)?.includes("tour-"));
        expect(gifs).toHaveLength(2);
        for (const args of gifs) {
            const filter = args[args.indexOf("-vf") + 1] ?? "";
            expect(filter).toContain("fps=5,scale=120:-1");
            expect(filter).toContain("max_colors=64");
        }
        expect(out()).toMatch(/✓ demo +tour-dark: gif 1 KB\n/);
    });

    it("uses the film's fps for the MP4, 10 for the GIF (the film's when lower), the frame width up to 1000 px for the GIF, the whole frame width for the poster", async () => {
        writeFilm(outDir, film({ name: "slow", fps: 4 }));
        writeFilm(outDir, film({ name: "wide", width: 2400, height: 100, frames: [{ hold: 1, background: GREEN }] }));
        const ffmpeg = fakeFfmpeg();
        expect(await run({ deps: depsWith(ffmpeg.tool) })).toBe(0);
        const filters = (name: string): string[] => ffmpeg.runs.filter((args) => new RegExp(`/${name}(\\.|-poster)`).test(args.at(-1) ?? "")).map((args) => args[args.indexOf("-vf") + 1] ?? "");
        const slow = filters("slow");
        expect(slow[0]).toContain("fps=4,");
        expect(slow[1]).toContain("fps=4,scale=200:-1");
        const wide = filters("wide");
        expect(wide[1]).toContain("fps=10,scale=1000:-1");
        expect(wide[2]).toBe("scale=2400:-1:flags=lanczos");
    });

    it("sets the poster width from the config, and warns when it is wider than the frames", async () => {
        writeFilm(outDir, film({ name: "a" }));
        writeFilm(outDir, film({ name: "b" }));
        writeFilm(outDir, film({ name: "c" }));
        const ffmpeg = fakeFfmpeg();
        const config: DemoConfig = { films: { a: { poster: { width: 80 } }, b: { poster: { width: 900 } }, c: { poster: true } } };
        expect(await run({ config, deps: depsWith(ffmpeg.tool) })).toBe(0);
        const poster = (name: string): string => ffmpeg.runs.map((args) => args.join(" ")).find((line) => line.endsWith(`${name}-poster.png`)) ?? "";
        expect(poster("a")).toContain("scale=80:-1");
        expect(poster("b")).toContain("scale=200:-1");
        expect(poster("c")).toContain("scale=200:-1");
        expect(out()).toMatch(/! demo +b: poster.width 900 is wider than the frames \(200 px\); using 200/);
        expect(out()).not.toMatch(/! demo +a: poster/);
    });

    it("warns when gif.width is wider than the frames and uses the frame width", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const ffmpeg = fakeFfmpeg();
        expect(await run({ config: { gif: { width: 900 } }, deps: depsWith(ffmpeg.tool) })).toBe(0);
        expect(out()).toMatch(/! demo +a: gif.width 900 is wider than the frames \(200 px\); using 200/);
        expect(ffmpeg.runs[1]?.join(" ")).toContain("scale=200:-1");
    });
});

describe("short holds", () => {
    it("names the frames held for less than one GIF frame, and is silent for the rest", async () => {
        writeFilm(outDir, film({ name: "quick", frames: [{ hold: 1, background: RED }, { hold: 0.04, background: BLUE }, { hold: 1, background: RED }] }));
        writeFilm(outDir, film({ name: "fine" }));
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(0);
        expect(out()).toMatch(/! demo +quick: frame 0002\.png \(0\.04 s\) is held for less than one GIF frame \(0\.10 s at 10 fps\)/);
        expect(out()).not.toMatch(/! demo +fine: frame/);
    });

    it("uses the configured gif fps, and says nothing without a GIF", async () => {
        writeFilm(outDir, film({ name: "a", frames: [{ hold: 1, background: RED }, { hold: 0.2, background: BLUE }, { hold: 1, background: RED }] }));
        await run({ config: { gif: { fps: 20 } }, deps: depsWith(fakeFfmpeg().tool) });
        expect(out()).not.toContain("GIF frame");
        ctx.out.length = 0;
        await run({ config: { gif: { fps: 4 } }, deps: depsWith(fakeFfmpeg().tool) });
        expect(out()).toMatch(/frame 0002\.png \(0\.2 s\) is held for less than one GIF frame \(0\.25 s at 4 fps\)/);
        ctx.out.length = 0;
        await run({ config: { gif: false }, deps: depsWith(fakeFfmpeg().tool) });
        expect(out()).not.toContain("GIF frame");
    });
});

describe("reporting", () => {
    it("prints one line per film with sizes and the poster", async () => {
        writeFilm(outDir, film({ name: "a" }));
        expect(await run({ deps: depsWith(fakeFfmpeg({ bytes: (file) => (file.endsWith(".mp4") ? 120 * 1024 : 340 * 1024) }).tool) })).toBe(0);
        expect(out()).toContain("✓ demo    a: mp4 120 KB, gif 340 KB, poster\n");
        expect(err()).toBe("");
    });

    it("warns above 2 MB and still exits 0", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const ffmpeg = fakeFfmpeg({ bytes: (file) => (file.endsWith(".gif") ? 3 * 1024 * 1024 : 1024) });
        expect(await run({ deps: depsWith(ffmpeg.tool) })).toBe(0);
        expect(out()).toMatch(/! demo +a: gif is 3\.0 MB, over the 2\.0 MB budget/);
        expect(out()).toMatch(/✓ demo +a: mp4 1 KB, gif 3\.0 MB, poster/);
    });

    it("fails above 10 MB, keeps the file and says what to lower", async () => {
        writeFilm(outDir, film({ name: "tour-dark", theme: "dark" }));
        const ffmpeg = fakeFfmpeg({ bytes: (file) => (file.endsWith(".gif") ? 11 * 1024 * 1024 : 1024) });
        expect(await run({ deps: depsWith(ffmpeg.tool) })).toBe(1);
        expect(err()).toMatch(/✗ demo +tour-dark: gif is 11\.0 MB, over the 10\.0 MB limit/);
        expect(err()).toContain("demo.films.tour.gif: width, colors, fps");
        expect(out()).not.toMatch(/✓ demo +tour-dark/);
        expect(media()).toContain("tour-dark.gif");
    });

    it("takes the budget from the config", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const ffmpeg = fakeFfmpeg({ bytes: () => 5000 });
        expect(await run({ config: { budget: { warnBytes: 1000, failBytes: 4000 } }, deps: depsWith(ffmpeg.tool) })).toBe(1);
        expect(err()).toMatch(/mp4 is 5 KB, over the 4 KB limit/);
    });

    it("fails with ffmpeg's message, keeps the previous good file instead of a half-written one and goes on with the next film", async () => {
        writeFilm(outDir, film({ name: "a-bad" }));
        writeFilm(outDir, film({ name: "b-good" }));
        fs.mkdirSync(path.join(cwd, "docs", "screens"), { recursive: true });
        fs.writeFileSync(path.join(cwd, "docs", "screens", "a-bad.gif"), "the previous good gif");
        const ffmpeg = fakeFfmpeg({ fail: (args) => (args.at(-1)?.endsWith("a-bad.gif") === true ? "ffmpeg exited with code 1:\nInvalid argument" : undefined) });
        expect(await run({ deps: depsWith(ffmpeg.tool) })).toBe(1);
        expect(err()).toMatch(/✗ demo +a-bad: ffmpeg exited with code 1:/);
        expect(err()).toContain("Invalid argument");
        expect(fs.readFileSync(path.join(cwd, "docs", "screens", "a-bad.gif"), "utf8")).toBe("the previous good gif");
        expect(media().filter((file) => file.includes(".opdk-partial"))).toEqual([]);
        expect(out()).toMatch(/✓ demo +b-good: /);
    });

    it("does not leave work files behind, after a run that succeeds or one that fails", async () => {
        writeFilm(outDir, film({ name: "a" }));
        writeFilm(outDir, film({ name: "b" }));
        await run({ deps: depsWith(fakeFfmpeg().tool) });
        expect(fs.readdirSync(privateTmp)).toEqual([]);
        await run({ deps: depsWith(fakeFfmpeg({ fail: (args) => (args.at(-1)?.endsWith("b.gif") === true ? "ffmpeg exited with code 1" : undefined) }).tool) });
        expect(fs.readdirSync(privateTmp)).toEqual([]);
    });

    it("moves a file across volumes by copying it next to its destination, then renaming", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const rename = fs.renameSync.bind(fs);
        const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            // Only the move out of the work folder crosses a "volume"; the rename of the copy inside the output folder is real.
            if (String(from).startsWith(privateTmp)) {
                throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
            }
            rename(from, to);
        });
        try {
            expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(0);
        } finally {
            spy.mockRestore();
        }
        expect(media()).toEqual(["a-poster.png", "a.gif", "a.mp4"]);
        expect(fs.readdirSync(privateTmp)).toEqual([]);
    });
});

describe("frame problems", () => {
    it("fails a film with a missing frame, naming it", async () => {
        writeFilm(outDir, film({ name: "a" }));
        fs.rmSync(path.join(outDir, "films", "a", "0002.png"));
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(1);
        expect(err()).toMatch(/✗ demo +a: frame 0002\.png is missing/);
    });

    it("warns about frames shot at scale 1", async () => {
        writeFilm(outDir, film({ name: "a", scale: 1 }));
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(0);
        expect(out()).toMatch(/! demo +a: shot at scale 1/);
    });
});

describe("the loop check", () => {
    const differing = (file: string): Buffer => {
        const raw = Buffer.alloc(200 * 100 * 4);
        if (file.endsWith("0003.png")) {
            raw.writeUInt32LE(0xffffffff, (10 * 200 + 20) * 4);
            raw.writeUInt32LE(0xffffffff, (12 * 200 + 25) * 4);
        }
        return raw;
    };

    it("is silent when the last frame differs from the first only by noise within the tolerance", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const noisy = (file: string): Buffer => {
            const raw = Buffer.alloc(200 * 100 * 4);
            if (file.endsWith("0003.png")) {
                for (let at = 0; at < raw.length; at += 4) {
                    raw[at] = 1;
                    raw[at + 2] = 3;
                }
            }
            return raw;
        };
        expect(await run({ config: { loop: "fail" }, deps: depsWith(fakeFfmpeg({ raw: noisy }).tool) })).toBe(0);
        expect(out()).not.toContain("loop does not close");
    });

    it("is silent when the last frame equals the first", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const ffmpeg = fakeFfmpeg();
        expect(await run({ deps: depsWith(ffmpeg.tool) })).toBe(0);
        expect(ffmpeg.captures).toHaveLength(2);
        expect(out()).not.toContain("loop does not close");
    });

    it("warns where the last frame differs, by default", async () => {
        writeFilm(outDir, film({ name: "a" }));
        expect(await run({ deps: depsWith(fakeFfmpeg({ raw: differing }).tool) })).toBe(0);
        expect(out()).toMatch(/! demo +a: loop does not close: the last frame differs from the first in a 6 x 3 px area at \(20, 10\)/);
        expect(out()).toMatch(/✓ demo +a: /);
    });

    it('fails with demo.loop "fail"', async () => {
        writeFilm(outDir, film({ name: "a" }));
        expect(await run({ config: { loop: "fail" }, deps: depsWith(fakeFfmpeg({ raw: differing }).tool) })).toBe(1);
        expect(err()).toMatch(/✗ demo +a: loop does not close/);
    });

    it("can be set per film, and the exact film entry wins over the top level", async () => {
        writeFilm(outDir, film({ name: "strict" }));
        writeFilm(outDir, film({ name: "loose" }));
        const config: DemoConfig = { loop: "fail", films: { loose: { loop: "off" }, strict: { loop: "warn" } } };
        expect(await run({ config, deps: depsWith(fakeFfmpeg({ raw: differing }).tool) })).toBe(0);
        expect(out()).toMatch(/! demo +strict: loop does not close/);
        expect(out()).not.toMatch(/loose: loop/);
        ctx.out.length = 0;
        expect(await run({ config: { loop: "fail", films: { loose: { loop: "off" } } }, deps: depsWith(fakeFfmpeg({ raw: differing }).tool) })).toBe(1);
        expect(err()).toMatch(/✗ demo +strict: loop does not close/);
        expect(err()).not.toMatch(/loose: loop/);
    });

    it('is not run with demo.loop "off", nor for a one-frame film', async () => {
        writeFilm(outDir, film({ name: "a" }));
        writeFilm(outDir, film({ name: "one", frames: [{ hold: 1, background: RED }] }));
        const ffmpeg = fakeFfmpeg({ raw: differing });
        expect(await run({ config: { loop: "off" }, deps: depsWith(ffmpeg.tool) })).toBe(0);
        expect(ffmpeg.captures).toHaveLength(0);
        const again = fakeFfmpeg({ raw: differing });
        await run({ names: ["one"], deps: depsWith(again.tool) });
        expect(again.captures).toHaveLength(0);
    });
});

describe("stale outputs and theme pairs", () => {
    const publishedFile = (): string => path.join(outDir, "published.json");
    const recorded = (): Record<string, string> => (JSON.parse(fs.readFileSync(publishedFile(), "utf8")) as { files: Record<string, string> }).files;
    const removeFilm = (name: string): void => {
        fs.rmSync(path.join(outDir, "films", name), { recursive: true, force: true });
    };

    it("records what it writes, keyed by output path, and names no media before there is a record", async () => {
        writeFilm(outDir, film({ name: "a" }));
        fs.mkdirSync(path.join(cwd, "docs", "screens"), { recursive: true });
        for (const file of ["gone.gif", "gone.mp4", "logo.png"]) {
            fs.writeFileSync(path.join(cwd, "docs", "screens", file), "x");
        }
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(0);
        expect(out()).not.toContain("no longer exist");
        expect(recorded()).toEqual({ "docs/screens/a.gif": "a", "docs/screens/a.mp4": "a", "docs/screens/a-poster.png": "a" });
        expect(media()).toContain("gone.gif");
    });

    it("warns about a file it published for a film that has since gone, and deletes nothing", async () => {
        writeFilm(outDir, film({ name: "a" }));
        writeFilm(outDir, film({ name: "b" }));
        fs.writeFileSync(path.join(cwd, "docs-unrelated.png"), "x");
        const deps = depsWith(fakeFfmpeg().tool);
        await run({ deps });
        removeFilm("b");
        ctx.out.length = 0;
        expect(await run({ deps })).toBe(0);
        expect(out()).toMatch(/! demo +media published by an earlier run of this command belongs to films that no longer exist: docs\/screens\/b-poster\.png, docs\/screens\/b\.gif, docs\/screens\/b\.mp4\./);
        expect(out()).not.toContain("docs-unrelated");
        expect(media()).toContain("b.gif");
        expect(recorded()["docs/screens/b.gif"]).toBe("b");
    });

    it("stops warning once the stale file is deleted, and drops it from the record", async () => {
        writeFilm(outDir, film({ name: "a" }));
        writeFilm(outDir, film({ name: "b" }));
        const deps = depsWith(fakeFfmpeg().tool);
        await run({ deps });
        removeFilm("b");
        for (const file of ["b.gif", "b.mp4", "b-poster.png"]) {
            fs.rmSync(path.join(cwd, "docs", "screens", file));
        }
        ctx.out.length = 0;
        await run({ deps });
        expect(out()).not.toContain("no longer exist");
        expect(Object.keys(recorded()).sort()).toEqual(["docs/screens/a-poster.png", "docs/screens/a.gif", "docs/screens/a.mp4"]);
    });

    it("after a rename, warns about the old name's files and records the new ones", async () => {
        writeFilm(outDir, film({ name: "old" }));
        const deps = depsWith(fakeFfmpeg().tool);
        await run({ deps });
        removeFilm("old");
        writeFilm(outDir, film({ name: "new" }));
        ctx.out.length = 0;
        await run({ deps });
        expect(out()).toMatch(/no longer exist: docs\/screens\/old-poster\.png, docs\/screens\/old\.gif, docs\/screens\/old\.mp4\./);
        expect(recorded()).toMatchObject({ "docs/screens/new.gif": "new", "docs/screens/old.gif": "old" });
    });

    it("warns about a file of a film that still exists when its mp4 is turned off, and keeps it recorded", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const deps = depsWith(fakeFfmpeg().tool);
        await run({ deps });
        ctx.out.length = 0;
        expect(await run({ deps, config: { mp4: false } })).toBe(0);
        expect(out()).toMatch(/! demo +media published by an earlier run of this command is no longer written by its film \(an output turned off, or moved\): docs\/screens\/a\.mp4\./);
        expect(out()).not.toContain("no longer exist");
        expect(media()).toContain("a.mp4");
        expect(recorded()["docs/screens/a.mp4"]).toBe("a");
    });

    it("warns about the old files when demo.output moves, and stops once they are deleted", async () => {
        writeFilm(outDir, film({ name: "a" }));
        const deps = depsWith(fakeFfmpeg().tool);
        await run({ deps });
        ctx.out.length = 0;
        await run({ deps, config: { output: "site/media" } });
        expect(out()).toMatch(/no longer written by its film.*: docs\/screens\/a-poster\.png, docs\/screens\/a\.gif, docs\/screens\/a\.mp4\./);
        expect(recorded()).toMatchObject({ "site/media/a.gif": "a", "docs/screens/a.gif": "a" });
        fs.rmSync(path.join(cwd, "docs", "screens"), { recursive: true });
        ctx.out.length = 0;
        await run({ deps, config: { output: "site/media" } });
        expect(out()).not.toContain("no longer");
        expect(Object.keys(recorded()).every((file) => file.startsWith("site/media/"))).toBe(true);
    });

    it("does not call a file stale when its film failed to encode this run", async () => {
        writeFilm(outDir, film({ name: "a" }));
        await run({ deps: depsWith(fakeFfmpeg().tool) });
        ctx.out.length = 0;
        expect(await run({ config: { mp4: false }, deps: depsWith(fakeFfmpeg({ fail: (args) => (args.at(-1)?.endsWith(".gif") === true ? "boom" : undefined) }).tool) })).toBe(1);
        expect(out()).not.toContain("no longer");
    });

    it("does not touch the record when nothing changed, and writes none when nothing was published", async () => {
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(1);
        expect(fs.existsSync(publishedFile())).toBe(false);
        writeFilm(outDir, film({ name: "a" }));
        const deps = depsWith(fakeFfmpeg().tool);
        await run({ deps });
        fs.utimesSync(publishedFile(), 1, 1);
        await run({ deps });
        expect(fs.statSync(publishedFile()).mtimeMs).toBe(1000);
    });

    it("warns about a record it cannot read, ignores it, and writes a fresh one", async () => {
        writeFilm(outDir, film({ name: "a" }));
        fs.writeFileSync(publishedFile(), "{ not json");
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(0);
        expect(out()).toMatch(/! demo +published\.json is not valid JSON.*ignoring it and writing a new one/);
        expect(recorded()).toHaveProperty(["docs/screens/a.gif"], "a");
    });

    it("replaces a record it cannot read even when a film fails to encode, so the next run starts clean", async () => {
        writeFilm(outDir, film({ name: "a" }));
        fs.writeFileSync(publishedFile(), "{ not json");
        const failing = fakeFfmpeg({ fail: (args) => (args.at(-1)?.endsWith(".mp4") === true ? "boom" : undefined) });
        expect(await run({ deps: depsWith(failing.tool) })).toBe(1);
        expect(out()).toMatch(/! demo +published\.json is not valid JSON/);
        expect(JSON.parse(fs.readFileSync(publishedFile(), "utf8"))).toEqual({ version: 1, files: {} });
    });

    it("does not call the output of a film stale when only another film was selected", async () => {
        writeFilm(outDir, film({ name: "a" }));
        writeFilm(outDir, film({ name: "b" }));
        const deps = depsWith(fakeFfmpeg().tool);
        await run({ deps });
        ctx.out.length = 0;
        await run({ names: ["a"], deps });
        expect(out()).not.toContain("no longer exist");
    });

    it("warns about a theme film whose partner is missing", async () => {
        writeFilm(outDir, film({ name: "tour-light", theme: "light" }));
        expect(await run({ deps: depsWith(fakeFfmpeg().tool) })).toBe(0);
        expect(out()).toMatch(/! demo +tour-light: the dark film "tour-dark" is missing/);
    });

    it("pairWarnings accepts a full pair and plain films", () => {
        expect(
            pairWarnings([
                { name: "x-light", theme: "light" },
                { name: "x-dark", theme: "dark" },
                { name: "y", theme: null },
            ]),
        ).toEqual([]);
        expect(pairWarnings([{ name: "x-dark", theme: "dark" }])[0]).toContain('the light film "x-light" is missing');
    });
});

describe('layout "phone-captions"', () => {
    const phone = (overrides: Partial<TestFilm> = {}): TestFilm =>
        film({ name: "phone", kind: "phone", width: 390, height: 780, captions: ["One", "Two"], frames: [{ hold: 1, caption: 0, background: RED }, { hold: 1, caption: 1, background: BLUE }], ...overrides });
    const config: DemoConfig = { layout: "phone-captions", phone: { accent: "#123456" } };

    it("composes the frames, then encodes the composed ones at the page size", async () => {
        writeFilm(outDir, phone());
        // The loop check reads the recorded 390 x 780 frames; asked for the composed size it would throw.
        const ffmpeg = fakeFfmpeg({ raw: () => Buffer.alloc(390 * 780 * 4) });
        const composed: string[] = [];
        const deps = depsWith(ffmpeg.tool, async (params) => {
            expect(params.cwd).toBe(cwd);
            expect(params.captions).toEqual(["One", "Two"]);
            expect(params.layout.accent).toBe("#123456");
            fs.mkdirSync(params.outDir, { recursive: true });
            for (const frame of params.frames) {
                fs.writeFileSync(path.join(params.outDir, frame.file), fakePng(2000, 1240));
                composed.push(path.join(params.outDir, frame.file));
            }
            await Promise.resolve();
        });
        expect(await run({ config, deps })).toBe(0);
        expect(out()).toMatch(/· demo +phone: composing 2 frames beside their captions in Electron/);
        const mp4 = ffmpeg.runs.find((args) => args.at(-1)?.endsWith("phone.mp4"));
        expect(mp4).toBeDefined();
        expect(composed).toHaveLength(2);
        // The loop check compared the recorded frames (the caption list around both ends would hide a jump).
        expect(ffmpeg.captures.map((args) => args[args.indexOf("-i") + 1])).toEqual([
            path.join(outDir, "films", "phone", "0001.png"),
            path.join(outDir, "films", "phone", "0002.png"),
        ]);
        expect(out()).not.toContain("loop does not close");
        const gif = ffmpeg.runs.find((args) => args.at(-1)?.endsWith("phone.gif"));
        expect(gif?.[gif.indexOf("-vf") + 1]).toContain("scale=1000:-1");
    });

    it("reports a jump in the recorded frames once, naming the recorded size, not the page", async () => {
        writeFilm(outDir, phone());
        const raw = (file: string): Buffer => {
            const buffer = Buffer.alloc(390 * 780 * 4);
            if (file.endsWith("0002.png")) {
                buffer.writeUInt32LE(0xffffffff, (5 * 390 + 7) * 4);
            }
            return buffer;
        };
        const deps = depsWith(fakeFfmpeg({ raw }).tool, (params) => {
            fs.mkdirSync(params.outDir, { recursive: true });
            for (const frame of params.frames) {
                fs.writeFileSync(path.join(params.outDir, frame.file), fakePng(2000, 1240));
            }
            return Promise.resolve();
        });
        expect(await run({ config, deps })).toBe(0);
        expect(out().match(/loop does not close/g)).toHaveLength(1);
        expect(out()).toMatch(/1 x 1 px area at \(7, 5\)/);
    });

    it("chooses the colours by the film's theme, then layers demo.phone, the base entry and the exact entry", async () => {
        writeFilm(outDir, phone({ name: "tour-light", theme: "light" }));
        writeFilm(outDir, phone({ name: "tour-dark", theme: "dark" }));
        writeFilm(outDir, phone({ name: "other" }));
        const layouts = new Map<string, PhoneLayout>();
        const deps = depsWith(fakeFfmpeg({ raw: () => Buffer.alloc(390 * 780 * 4) }).tool, (params) => {
            layouts.set(path.basename(params.filmDir), params.layout);
            fs.mkdirSync(params.outDir, { recursive: true });
            for (const frame of params.frames) {
                fs.writeFileSync(path.join(params.outDir, frame.file), fakePng(2000, 1240));
            }
            return Promise.resolve();
        });
        const themed: DemoConfig = {
            layout: "phone-captions",
            phone: { accent: "#111111", text: "#222222", light: { background: "#fafafa" }, dark: { background: "#050505", accent: "#999999" } },
            films: { tour: { phone: { dark: { text: "#eeeeee" } } }, "tour-dark": { phone: { accent: "#abcdef" } } },
        };
        expect(await run({ config: themed, deps })).toBe(0);
        expect(layouts.get("tour-light")).toMatchObject({ background: "#fafafa", accent: "#111111", text: "#222222" });
        // tour-dark: demo's dark entry, the base entry's dark text, then the exact entry's flat accent beats demo's dark accent.
        expect(layouts.get("tour-dark")).toMatchObject({ background: "#050505", accent: "#abcdef", text: "#eeeeee" });
        // No theme: the flat colours over the light defaults, no theme entries.
        expect(layouts.get("other")).toMatchObject({ accent: "#111111", text: "#222222" });
        expect(layouts.get("other")?.background).toBe(resolvePhoneLayout([], null).background);
    });

    it("fails for a desktop film", async () => {
        writeFilm(outDir, film({ name: "desk", captions: ["x"] }));
        expect(await run({ config, deps: depsWith(fakeFfmpeg().tool) })).toBe(1);
        expect(err()).toMatch(/layout "phone-captions" is for phone films, and this is a desktop film/);
    });

    it("fails for a film without captions", async () => {
        writeFilm(outDir, phone({ captions: [], frames: [{ hold: 1, background: RED }] }));
        expect(await run({ config, deps: depsWith(fakeFfmpeg().tool) })).toBe(1);
        expect(err()).toMatch(/this film has none\. Pass captions to demo\.film\(\)/);
    });

    it("fails when the renderer returns frames of another size", async () => {
        writeFilm(outDir, phone());
        const deps = depsWith(fakeFfmpeg({ raw: () => Buffer.alloc(390 * 780 * 4) }).tool, (params) => {
            fs.mkdirSync(params.outDir, { recursive: true });
            for (const frame of params.frames) {
                fs.writeFileSync(path.join(params.outDir, frame.file), fakePng(1000, 620));
            }
            return Promise.resolve();
        });
        expect(await run({ config, deps })).toBe(1);
        expect(err()).toMatch(/frame 0001\.png is 1000 x 620 px but the manifest says 2000 x 1240/);
    });

    it("passes a renderer error through", async () => {
        writeFilm(outDir, phone());
        const deps = depsWith(fakeFfmpeg({ raw: () => Buffer.alloc(390 * 780 * 4) }).tool, () => Promise.reject(new Error("Cannot find the electron package")));
        expect(await run({ config, deps })).toBe(1);
        expect(err()).toMatch(/✗ demo +phone: Cannot find the electron package/);
    });
});

interface Probe {
    width: number;
    height: number;
    duration: number;
    pixFmt: string;
    codec: string;
}

function probe(file: string): Probe {
    const text = execFileSync(
        "ffprobe",
        ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt,codec_name:format=duration", "-of", "json", file],
        { encoding: "utf8" },
    );
    const json = JSON.parse(text) as { streams: { width: number; height: number; pix_fmt: string; codec_name: string }[]; format: { duration: string } };
    const stream = json.streams[0];
    if (stream === undefined) {
        throw new Error(`ffprobe found no video stream in ${file}`);
    }
    return { width: stream.width, height: stream.height, duration: Number(json.format.duration), pixFmt: stream.pix_fmt, codec: stream.codec_name };
}

// Real ffmpeg on small generated frames. Locally the group is skipped, with the reason in its title, on a machine
// without ffmpeg/ffprobe; on CI the group always runs, so a runner without them fails instead of skipping.
const realTools = realToolsGate("with a real ffmpeg", hasTool("ffmpeg") && hasTool("ffprobe"));
describe.skipIf(realTools.skip)(realTools.title, () => {
    it("has ffmpeg and ffprobe", () => {
        expect(hasTool("ffmpeg") && hasTool("ffprobe"), "ffmpeg and ffprobe must be installed (on CI: apt install ffmpeg)").toBe(true);
    });

    it("encodes a film: MP4 and GIF last as long as the holds, the poster is the MP4's size, sizes are the frames'", async () => {
        writeFilm(outDir, film({ name: "real" }));
        expect(await run()).toBe(0);
        expect(out()).toMatch(/✓ demo +real: mp4 \d+ KB, gif \d+ KB, poster/);
        expect(out()).not.toContain("loop does not close");
        const dir = path.join(cwd, "docs", "screens");
        const mp4 = probe(path.join(dir, "real.mp4"));
        expect(mp4).toMatchObject({ width: 200, height: 100, codec: "h264", pixFmt: "yuv420p" });
        expect(mp4.duration).toBeGreaterThan(2.3);
        expect(mp4.duration).toBeLessThan(2.8);
        const gif = probe(path.join(dir, "real.gif"));
        expect(gif).toMatchObject({ width: 200, height: 100, codec: "gif" });
        expect(gif.duration).toBeGreaterThan(2.3);
        expect(gif.duration).toBeLessThan(2.9);
        expect(readPngSize(fs.readFileSync(path.join(dir, "real-poster.png")))).toEqual({ width: 200, height: 100 });
        // faststart: the moov atom comes before the media data.
        const head = fs.readFileSync(path.join(dir, "real.mp4")).subarray(0, 4096).toString("latin1");
        expect(head.indexOf("moov")).toBeGreaterThan(-1);
        expect(head.indexOf("moov")).toBeLessThan(!head.includes("mdat") ? Infinity : head.indexOf("mdat"));
    });

    it("scales a wide film down to 1000 px for the GIF only, keeps the poster at the frame width, and makes odd sizes even for the MP4", async () => {
        writeFilm(outDir, film({ name: "wide", width: 1601, height: 301, frames: [{ hold: 1, background: GREEN }, { hold: 1, background: GREEN, boxes: [{ x: 0, y: 0, width: 5, height: 5, ...RED }] }, { hold: 1, background: GREEN }] }));
        expect(await run()).toBe(0);
        const dir = path.join(cwd, "docs", "screens");
        expect(probe(path.join(dir, "wide.gif")).width).toBe(1000);
        expect(readPngSize(fs.readFileSync(path.join(dir, "wide-poster.png"))).width).toBe(1601);
        expect(probe(path.join(dir, "wide.mp4"))).toMatchObject({ width: 1600, height: 300 });
    });

    it("reports a loop that does not close, with where the frames differ", async () => {
        writeFilm(outDir, film({ name: "jump", frames: [{ hold: 1, background: RED }, { hold: 1, background: RED, boxes: [{ x: 30, y: 40, width: 20, height: 10, ...BLUE }] }] }));
        expect(await run()).toBe(0);
        expect(out()).toMatch(/! demo +jump: loop does not close: .* 20 x 10 px area at \(30, 40\)/);
        ctx.out.length = 0;
        expect(await run({ config: { loop: "fail" } })).toBe(1);
        expect(err()).toMatch(/✗ demo +jump: loop does not close/);
    });

    it("fails with the tail of ffmpeg's stderr when a frame cannot be decoded, and leaves no partial file", async () => {
        writeFilm(outDir, film({ name: "broken" }));
        // The header says 200 x 100, so the size check passes; the rest is not an image.
        fs.writeFileSync(path.join(outDir, "films", "broken", "0002.png"), fakePng(200, 100));
        expect(await run()).toBe(1);
        expect(err()).toMatch(/✗ demo +broken: .*ffmpeg.* exited with code (0 but reported errors|\d+):/);
        expect(media().filter((file) => file.startsWith("broken"))).toEqual([]);
    });

    it("runs in a folder whose name has a percent sign: frames, concat list, poster and raw frames all read as single files", async () => {
        const odd = fs.mkdtempSync(path.join(testTmpRoot(), "opdk-100%d-"));
        try {
            const oddOut = path.join(odd, ".opdk", "demo");
            writeFilm(oddOut, film({ name: "pct" }));
            const code = await runDemo({
                cwd: odd,
                env: {},
                names: [],
                config: {},
                reporter: ctx.reporter,
                source: "test",
                tmpDir: privateTmp,
            });
            expect(err()).toBe("");
            expect(code).toBe(0);
            expect(fs.readdirSync(path.join(odd, "docs", "screens")).sort()).toEqual(["pct-poster.png", "pct.gif", "pct.mp4"]);
            expect(probe(path.join(odd, "docs", "screens", "pct.gif"))).toMatchObject({ width: 200, height: 100 });
        } finally {
            fs.rmSync(odd, { recursive: true, force: true });
        }
    });

    it("keeps the previous good file when an encode fails", async () => {
        writeFilm(outDir, film({ name: "broken" }));
        fs.mkdirSync(path.join(cwd, "docs", "screens"), { recursive: true });
        fs.writeFileSync(path.join(cwd, "docs", "screens", "broken.mp4"), "old mp4");
        fs.writeFileSync(path.join(outDir, "films", "broken", "0002.png"), fakePng(200, 100));
        expect(await run()).toBe(1);
        expect(fs.readFileSync(path.join(cwd, "docs", "screens", "broken.mp4"), "utf8")).toBe("old mp4");
        expect(media()).toEqual(["broken.mp4"]);
    });

    it("honours OPDK_FFMPEG through the default preflight", async () => {
        writeFilm(outDir, film({ name: "a" }));
        expect(await run({ env: { OPDK_FFMPEG: path.join(cwd, "no-ffmpeg-here") } }).catch((error: unknown) => String(error))).toMatch(/OPDK_FFMPEG=.*cannot run/);
        expect(media()).toEqual([]);
    });
});

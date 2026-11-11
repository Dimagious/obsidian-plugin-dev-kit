import { describe, expect, it } from "vitest";
import type { FilmFrame } from "../e2e/demo/manifest.js";
import {
    buildConcatList,
    FFMPEG_ENV,
    gifArgs,
    INSTALL_HINT,
    locateFfmpeg,
    mp4Args,
    posterArgs,
    rawFrameArgs,
    resolveGifWidth,
    stderrTail,
    totalHold,
} from "./ffmpeg.js";

const frames: FilmFrame[] = [
    { file: "0001.png", hold: 1, caption: null },
    { file: "0002.png", hold: 0.4, caption: 0 },
    { file: "0003.png", hold: 2.25, caption: null },
];

describe("locateFfmpeg", () => {
    it("uses ffmpeg from PATH by default", async () => {
        const seen: string[] = [];
        const found = await locateFfmpeg({}, (command) => {
            seen.push(command);
            return Promise.resolve({ ok: true, version: "ffmpeg version 7" });
        });
        expect(found).toEqual({ command: "ffmpeg", version: "ffmpeg version 7" });
        expect(seen).toEqual(["ffmpeg"]);
    });

    it("prefers OPDK_FFMPEG and ignores an empty one", async () => {
        const probe = (command: string): Promise<{ ok: boolean; version: string }> => Promise.resolve({ ok: true, version: command });
        expect((await locateFfmpeg({ [FFMPEG_ENV]: "/opt/ff/ffmpeg" }, probe)).command).toBe("/opt/ff/ffmpeg");
        expect((await locateFfmpeg({ [FFMPEG_ENV]: "" }, probe)).command).toBe("ffmpeg");
    });

    it("says how to install ffmpeg when PATH has none", async () => {
        await expect(locateFfmpeg({}, () => Promise.resolve({ ok: false, error: "spawn ffmpeg ENOENT" }))).rejects.toThrow(
            `ffmpeg was not found on PATH (spawn ffmpeg ENOENT). ${INSTALL_HINT}`,
        );
        expect(INSTALL_HINT).toContain("brew install ffmpeg");
        expect(INSTALL_HINT).toContain(FFMPEG_ENV);
    });

    it("does not fall back to PATH when OPDK_FFMPEG is set but broken", async () => {
        const seen: string[] = [];
        await expect(
            locateFfmpeg({ [FFMPEG_ENV]: "/nope/ffmpeg" }, (command) => {
                seen.push(command);
                return Promise.resolve({ ok: false, error: "ENOENT" });
            }),
        ).rejects.toThrow("OPDK_FFMPEG=/nope/ffmpeg cannot run (ENOENT). Point it at a working ffmpeg binary or unset it");
        expect(seen).toEqual(["/nope/ffmpeg"]);
    });
});

describe("buildConcatList", () => {
    it("gives each frame its own duration and repeats the last file so its duration counts", () => {
        expect(buildConcatList("/films/a", frames)).toBe(
            [
                "ffconcat version 1.0",
                "file '/films/a/0001.png'",
                "option pattern_type none",
                "duration 1.000",
                "file '/films/a/0002.png'",
                "option pattern_type none",
                "duration 0.400",
                "file '/films/a/0003.png'",
                "option pattern_type none",
                "duration 2.250",
                "file '/films/a/0003.png'",
                "option pattern_type none",
                "",
            ].join("\n"),
        );
    });

    it("escapes a single quote in the path", () => {
        const list = buildConcatList("/it's here", [{ file: "0001.png", hold: 1, caption: null }]);
        expect(list).toContain("file '/it'\\''s here/0001.png'");
    });

    it("refuses an empty film", () => {
        expect(() => buildConcatList("/x", [])).toThrow("zero frames");
    });
});

describe("totalHold", () => {
    it("sums the holds", () => {
        expect(totalHold(frames)).toBeCloseTo(3.65, 6);
        expect(totalHold([])).toBe(0);
    });
});

describe("encode arguments", () => {
    it("MP4: concat input capped at the sum of the holds, x264 yuv420p crf 20, faststart, even size, no audio", () => {
        const args = mp4Args({ list: "/w/l.ffconcat", frames, fps: 15, out: "/o/a.mp4" });
        expect(args.slice(0, 4)).toEqual(["-hide_banner", "-v", "error", "-y"]);
        expect(args.join(" ")).toContain("-f concat -safe 0 -i /w/l.ffconcat -t 3.650");
        expect(args).toContain("fps=15,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p");
        expect(args.join(" ")).toContain("-c:v libx264 -crf 20 -preset slow -movflags +faststart -an /o/a.mp4");
    });

    it("GIF: own palette from the diff stats, bayer dithering, endless loop, the chosen fps, width and colours", () => {
        const args = gifArgs({ list: "/w/l", frames, fps: 10, width: 900, colors: 96, out: "/o/a.gif" });
        const filter = args[args.indexOf("-vf") + 1];
        expect(filter).toBe(
            "fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        );
        expect(args.join(" ")).toContain("-t 3.650");
        expect(args.slice(-3)).toEqual(["-loop", "0", "/o/a.gif"]);
    });

    it("poster: one frame scaled to the given width, read and written as single files", () => {
        expect(posterArgs({ frame: "/f/0001.png", width: 800, out: "/o/a-poster.png" })).toEqual([
            "-hide_banner", "-v", "error", "-y", "-f", "image2", "-pattern_type", "none", "-i", "/f/0001.png", "-vf", "scale=800:-1:flags=lanczos", "-frames:v", "1", "-update", "1", "/o/a-poster.png",
        ]);
    });

    it("raw frame: one RGBA picture on stdout", () => {
        expect(rawFrameArgs("/f/1.png").slice(4)).toEqual(["-f", "image2", "-pattern_type", "none", "-i", "/f/1.png", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]);
    });
});

describe("stderrTail", () => {
    it("keeps the last non-empty lines", () => {
        const text = Array.from({ length: 20 }, (_, i) => `line ${String(i)}`).join("\n") + "\n\n";
        expect(stderrTail(text, 3)).toBe("line 17\nline 18\nline 19");
        expect(stderrTail("", 3)).toBe("");
        expect(stderrTail("a\r\nb\r\n")).toBe("a\nb");
    });
});

describe("resolveGifWidth", () => {
    it("takes the frame width up to the cap", () => {
        expect(resolveGifWidth(null, 780, 1000)).toEqual({ width: 780, clamped: false });
        expect(resolveGifWidth(null, 2400, 1000)).toEqual({ width: 1000, clamped: false });
    });

    it("keeps a configured width, but never upscales", () => {
        expect(resolveGifWidth(600, 780, 1000)).toEqual({ width: 600, clamped: false });
        expect(resolveGifWidth(1200, 780, 1000)).toEqual({ width: 780, clamped: true });
        expect(resolveGifWidth(780, 780, 1000)).toEqual({ width: 780, clamped: false });
    });
});

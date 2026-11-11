import { describe, expect, it } from "vitest";
import { newManifest, type FilmManifest } from "../e2e/demo/manifest.js";
import {
    budgetVerdict,
    compareFrames,
    densityWarnings,
    describeLoopDifference,
    filmOfOutput,
    findStaleOutputs,
    formatBytes,
    shortHoldWarning,
} from "./checks.js";

const BUDGET = { warnBytes: 2000, failBytes: 10_000 };

describe("formatBytes", () => {
    it("prints KB below a megabyte and MB above, never 0 KB", () => {
        expect(formatBytes(1)).toBe("1 KB");
        expect(formatBytes(120 * 1024)).toBe("120 KB");
        expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
        expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    });
});

describe("budgetVerdict", () => {
    it("is ok up to and including the warn limit, warns above it, fails above the fail limit", () => {
        expect(budgetVerdict(2000, BUDGET)).toBe("ok");
        expect(budgetVerdict(2001, BUDGET)).toBe("warn");
        expect(budgetVerdict(10_000, BUDGET)).toBe("warn");
        expect(budgetVerdict(10_001, BUDGET)).toBe("fail");
        expect(budgetVerdict(0, BUDGET)).toBe("ok");
    });
});

describe("filmOfOutput / findStaleOutputs", () => {
    it("maps the three output kinds back to a film and ignores other files", () => {
        expect(filmOfOutput("tour.mp4")).toBe("tour");
        expect(filmOfOutput("tour.gif")).toBe("tour");
        expect(filmOfOutput("tour-poster.png")).toBe("tour");
        expect(filmOfOutput("tour.poster.png")).toBeNull();
        expect(filmOfOutput("logo.png")).toBeNull();
        expect(filmOfOutput("notes.md")).toBeNull();
    });

    it("lists media with no current film, sorted, and leaves foreign files alone", () => {
        const files = ["b-old.gif", "tour.mp4", "tour.gif", "tour-poster.png", "a-old-poster.png", "a-old.mp4", "logo.png", "README.md"];
        expect(findStaleOutputs(files, new Set(["tour"]))).toEqual(["a-old-poster.png", "a-old.mp4", "b-old.gif"]);
        expect(findStaleOutputs(files, new Set(["tour", "a-old", "b-old"]))).toEqual([]);
        expect(findStaleOutputs([], new Set())).toEqual([]);
    });
});

function manifest(overrides: Partial<FilmManifest>): FilmManifest {
    return { ...newManifest({ name: "a", kind: "desktop", fps: 15, scale: 2, theme: null, captions: [] }), width: 800, height: 600, ...overrides };
}

describe("densityWarnings", () => {
    it("is silent for a 2x film with whole CSS pixels", () => {
        expect(densityWarnings(manifest({}))).toEqual([]);
        expect(densityWarnings(manifest({ scale: 3, width: 900, height: 600 }))).toEqual([]);
    });

    it("warns about 1x frames", () => {
        const [warning] = densityWarnings(manifest({ scale: 1 }));
        expect(warning).toMatch(/shot at scale 1: .*soft/);
    });

    it("warns when the pixel size is not a multiple of the scale", () => {
        const warnings = densityWarnings(manifest({ scale: 2, width: 801 }));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/801 x 600 px, not a whole number of CSS pixels at scale 2/);
    });

    it("says nothing about a size it does not have", () => {
        expect(densityWarnings(manifest({ width: null, height: null }))).toEqual([]);
    });
});

function rgba(width: number, height: number, paint: (x: number, y: number) => number): Buffer {
    const buffer = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            buffer.writeUInt32LE(paint(x, y), (y * width + x) * 4);
        }
    }
    return buffer;
}

describe("compareFrames", () => {
    it("returns null for identical pictures", () => {
        const a = rgba(4, 3, () => 0xff0000ff);
        expect(compareFrames(a, Buffer.from(a), 4, 3)).toBeNull();
    });

    it("boxes every differing pixel and counts them", () => {
        const a = rgba(10, 8, () => 0xff000000);
        const b = rgba(10, 8, (x, y) => ((x === 2 && y === 3) || (x === 5 && y === 6) ? 0xffffffff : 0xff000000));
        expect(compareFrames(a, b, 10, 8)).toEqual({ x: 2, y: 3, width: 4, height: 4, ratio: 2 / 80 });
    });

    it("finds a single differing pixel at the corner", () => {
        const a = rgba(3, 3, () => 0);
        const b = rgba(3, 3, (x, y) => (x === 2 && y === 2 ? 1 : 0));
        expect(compareFrames(a, b, 3, 3)).toEqual({ x: 2, y: 2, width: 1, height: 1, ratio: 1 / 9 });
    });

    it("sees a difference in one channel only: green, red, blue or alpha of a single pixel", () => {
        const width = 4;
        const height = 2;
        const base = rgba(width, height, () => 0xff102030);
        // Little-endian words: the byte order in memory is R, G, B, A.
        for (const changed of [0xff102031, 0xff102130, 0xff112030, 0xfe102030]) {
            const other = rgba(width, height, (x, y) => (x === 3 && y === 1 ? changed : 0xff102030));
            expect(compareFrames(base, other, width, height)).toEqual({ x: 3, y: 1, width: 1, height: 1, ratio: 1 / 8 });
        }
        const greenOnly = Buffer.from(base);
        greenOnly[1] = (greenOnly[1] ?? 0) + 1;
        expect(compareFrames(base, greenOnly, width, height)).toEqual({ x: 0, y: 0, width: 1, height: 1, ratio: 1 / 8 });
    });

    it("fails on a buffer that is not width x height RGBA", () => {
        expect(() => compareFrames(Buffer.alloc(10), Buffer.alloc(10), 2, 2)).toThrow(/expected 16 bytes of 2 x 2 RGBA, got 10 and 10/);
    });
});

describe("describeLoopDifference", () => {
    it("says where the frames differ and what to do", () => {
        const text = describeLoopDifference({ x: 300, y: 20, width: 120, height: 40, ratio: 0.0123 });
        expect(text).toContain("loop does not close");
        expect(text).toContain("120 x 40 px area at (300, 20)");
        expect(text).toContain("1.2% of the pixels");
        expect(text).toContain('demo.loop to "off"');
    });

    it("does not print 0.0% for a tiny difference", () => {
        expect(describeLoopDifference({ x: 0, y: 0, width: 1, height: 1, ratio: 0.00001 })).toContain("under 0.1% of the pixels");
    });
});

describe("shortHoldWarning", () => {
    const frame = (file: string, hold: number): { file: string; hold: number; caption: null } => ({ file, hold, caption: null });

    it("is null when every frame is held for at least one GIF frame, exactly one included", () => {
        expect(shortHoldWarning([frame("0001.png", 1), frame("0002.png", 0.1)], 10)).toBeNull();
        expect(shortHoldWarning([frame("0001.png", 0.25)], 4)).toBeNull();
        expect(shortHoldWarning([], 10)).toBeNull();
    });

    it("names the frame and the frame length of the GIF", () => {
        const text = shortHoldWarning([frame("0001.png", 1), frame("0002.png", 0.05)], 10);
        expect(text).toContain("frame 0002.png (0.05 s) is held for less than one GIF frame (0.10 s at 10 fps)");
        expect(text).toContain("Hold it longer, or raise gif.fps");
    });

    it("names several frames, and counts the rest past five", () => {
        const many = Array.from({ length: 7 }, (_, index) => frame(`000${String(index + 1)}.png`, 0.01));
        const text = shortHoldWarning(many, 10) ?? "";
        expect(text).toContain("frames 0001.png (0.01 s), 0002.png (0.01 s), 0003.png (0.01 s), 0004.png (0.01 s), 0005.png (0.01 s) and 2 more are held");
        expect(text).toContain("skip them");
        expect(text).not.toContain("0006.png");
    });
});

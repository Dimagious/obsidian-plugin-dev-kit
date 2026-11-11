import fs from "node:fs";
import path from "node:path";
import { frameFileName, newManifest, serializeManifest, type FilmKind, type FilmManifest } from "../e2e/demo/manifest.js";
import type { ThemeMode } from "../e2e/demo/names.js";
import { realPng, type Box, type Rgb } from "./real-png.js";

export interface TestFrame {
    readonly hold: number;
    readonly caption?: number | null;
    readonly background: Rgb;
    readonly boxes?: readonly Box[];
}

export interface TestFilm {
    readonly name: string;
    readonly kind?: FilmKind;
    readonly fps?: number;
    readonly scale?: number;
    readonly theme?: ThemeMode | null;
    readonly captions?: readonly string[];
    readonly width: number;
    readonly height: number;
    readonly frames: readonly TestFrame[];
    readonly complete?: boolean;
}

export const RED: Rgb = { r: 220, g: 40, b: 40 };
export const GREEN: Rgb = { r: 40, g: 180, b: 80 };
export const BLUE: Rgb = { r: 40, g: 80, b: 220 };

/** Writes `<outDir>/films/<name>/` the way the demo fixture does: real PNG frames, manifest.json and owner.json. Returns the manifest. */
export function writeFilm(outDir: string, film: TestFilm): FilmManifest {
    const dir = path.join(outDir, "films", film.name);
    fs.mkdirSync(dir, { recursive: true });
    const frames = film.frames.map((frame, index) => {
        fs.writeFileSync(path.join(dir, frameFileName(index)), realPng(film.width, film.height, frame.background, frame.boxes));
        return { file: frameFileName(index), hold: frame.hold, caption: frame.caption ?? null };
    });
    const manifest: FilmManifest = {
        ...newManifest({
            name: film.name,
            kind: film.kind ?? "desktop",
            fps: film.fps ?? 15,
            scale: film.scale ?? 2,
            theme: film.theme ?? null,
            captions: film.captions ?? [],
        }),
        width: frames.length === 0 ? null : film.width,
        height: frames.length === 0 ? null : film.height,
        complete: film.complete ?? true,
        frames,
    };
    fs.writeFileSync(path.join(dir, "manifest.json"), serializeManifest(manifest));
    // The recorder's bookkeeping: `opdk demo` must ignore it.
    fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify({ testId: "t", runId: "r", title: "x" }));
    return manifest;
}

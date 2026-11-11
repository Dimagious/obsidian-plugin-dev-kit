import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakePng } from "../test-support/demo-fakes.js";
import { BLUE, RED, writeFilm } from "../test-support/demo-films.js";
import { assertFrameFiles, incompleteReason, listFilms, readPngFileSize } from "./films.js";

let dir: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-demo-films-"));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

const frames = [{ hold: 1, background: RED }, { hold: 1, background: BLUE }];

describe("listFilms", () => {
    it("is empty when there is no films folder", () => {
        expect(listFilms(dir)).toEqual({ complete: [], incomplete: [], broken: [] });
    });

    it("lists complete films sorted by name, with their folder and manifest", () => {
        writeFilm(dir, { name: "b-film", width: 20, height: 10, frames });
        writeFilm(dir, { name: "a-film", width: 20, height: 10, frames });
        const { complete } = listFilms(dir);
        expect(complete.map((film) => film.name)).toEqual(["a-film", "b-film"]);
        expect(complete[0]?.dir).toBe(path.join(dir, "films", "a-film"));
        expect(complete[0]?.manifest.frames).toHaveLength(2);
    });

    it("sets aside a film whose recording did not finish, and one with no frames, with the reason", () => {
        writeFilm(dir, { name: "half", width: 20, height: 10, frames, complete: false });
        writeFilm(dir, { name: "empty", width: 20, height: 10, frames: [] });
        const { complete, incomplete } = listFilms(dir);
        expect(complete).toEqual([]);
        expect(incomplete.map((film) => film.name)).toEqual(["empty", "half"]);
        expect(incomplete.find((film) => film.name === "half")?.reason).toMatch(/recording did not finish/);
        expect(incomplete.find((film) => film.name === "empty")?.reason).toMatch(/no frames/);
    });

    it("ignores owner.json, .owners/ and stray files next to the film folders", () => {
        writeFilm(dir, { name: "a", width: 20, height: 10, frames });
        fs.mkdirSync(path.join(dir, ".owners", "stills"), { recursive: true });
        fs.writeFileSync(path.join(dir, "films", "notes.txt"), "x");
        const listing = listFilms(dir);
        expect(listing.complete.map((film) => film.name)).toEqual(["a"]);
        expect(listing.broken).toEqual([]);
    });

    it("reports a folder without a manifest, an unreadable manifest and a renamed folder as broken", () => {
        fs.mkdirSync(path.join(dir, "films", "no-manifest"), { recursive: true });
        fs.mkdirSync(path.join(dir, "films", "bad-json"), { recursive: true });
        fs.writeFileSync(path.join(dir, "films", "bad-json", "manifest.json"), "{nope");
        writeFilm(dir, { name: "original", width: 20, height: 10, frames });
        fs.renameSync(path.join(dir, "films", "original"), path.join(dir, "films", "renamed"));
        const { broken, complete } = listFilms(dir);
        expect(complete).toEqual([]);
        expect(broken.map((film) => film.name)).toEqual(["bad-json", "no-manifest", "renamed"]);
        expect(broken[0]?.reason).toMatch(/not valid JSON/);
        expect(broken[1]?.reason).toMatch(/manifest\.json is missing/);
        expect(broken[2]?.reason).toMatch(/says the film is "original", not the folder name/);
    });

    it("rethrows a read error that is not 'missing'", () => {
        fs.mkdirSync(path.join(dir, "films"), { recursive: true });
        fs.writeFileSync(path.join(dir, "films", "file"), "x");
        // `films` is a file here, so listing it is ENOTDIR, which must not pass for 'no films'.
        expect(() => listFilms(path.join(dir, "films", "file"))).toThrow(/ENOTDIR/);
    });
});

describe("incompleteReason", () => {
    it("is null for a finished film with frames", () => {
        const manifest = writeFilm(dir, { name: "a", width: 20, height: 10, frames });
        expect(incompleteReason(manifest)).toBeNull();
    });
});

describe("readPngFileSize / assertFrameFiles", () => {
    it("reads the size from the header only", () => {
        const file = path.join(dir, "x.png");
        fs.writeFileSync(file, fakePng(780, 1688));
        expect(readPngFileSize(file)).toEqual({ width: 780, height: 1688 });
    });

    it("passes frames of the expected size", () => {
        const manifest = writeFilm(dir, { name: "a", width: 20, height: 10, frames });
        expect(() => { assertFrameFiles(path.join(dir, "films", "a"), manifest.frames, manifest); }).not.toThrow();
    });

    it("names a missing frame and what to do", () => {
        const manifest = writeFilm(dir, { name: "a", width: 20, height: 10, frames });
        fs.rmSync(path.join(dir, "films", "a", "0002.png"));
        expect(() => { assertFrameFiles(path.join(dir, "films", "a"), manifest.frames, manifest); }).toThrow(/frame 0002\.png is missing from .*Run the spec again/);
    });

    it("names a frame that is not a PNG", () => {
        const manifest = writeFilm(dir, { name: "a", width: 20, height: 10, frames });
        fs.writeFileSync(path.join(dir, "films", "a", "0001.png"), "plain text, long enough to look like a header");
        expect(() => { assertFrameFiles(path.join(dir, "films", "a"), manifest.frames, manifest); }).toThrow(/frame 0001\.png is not a readable PNG/);
    });

    it("names a frame whose size differs from the manifest", () => {
        const manifest = writeFilm(dir, { name: "a", width: 20, height: 10, frames });
        fs.writeFileSync(path.join(dir, "films", "a", "0002.png"), fakePng(21, 10));
        expect(() => { assertFrameFiles(path.join(dir, "films", "a"), manifest.frames, manifest); }).toThrow(
            /frame 0002\.png is 21 x 10 px but the manifest says 20 x 10/,
        );
    });
});

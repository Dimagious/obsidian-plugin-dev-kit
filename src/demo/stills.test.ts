import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listStills, publishStill, stillKey } from "./stills.js";

let root: string;
let outDir: string;
let folder: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-demo-stills-"));
    outDir = path.join(root, "out");
    folder = path.join(root, "docs", "screens");
    fs.mkdirSync(path.join(outDir, "stills"), { recursive: true });
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

const writeStill = (name: string, content: string): void => {
    fs.writeFileSync(path.join(outDir, "stills", `${name}.png`), content);
};

describe("stillKey", () => {
    it("cannot equal a film name, which never holds a colon", () => {
        expect(stillKey("hero")).toBe("still:hero");
    });
});

describe("listStills", () => {
    it("lists the PNGs by name, sorted, and ignores other files and folders", () => {
        writeStill("b", "x");
        writeStill("a", "x");
        fs.writeFileSync(path.join(outDir, "stills", "notes.txt"), "x");
        fs.mkdirSync(path.join(outDir, "stills", "sub.png"));
        expect(listStills(outDir)).toEqual(["a", "b"]);
    });

    it("is empty when there is no stills folder, and fails on one it cannot read", () => {
        expect(listStills(path.join(root, "nowhere"))).toEqual([]);
        fs.rmSync(path.join(outDir, "stills"), { recursive: true });
        fs.writeFileSync(path.join(outDir, "stills"), "a file, not a folder");
        expect(() => listStills(outDir)).toThrow(/ENOTDIR/);
    });
});

describe("publishStill", () => {
    it("creates the folder and copies the picture under its name", () => {
        writeStill("hero", "pixels");
        const result = publishStill(outDir, "hero", folder);
        expect(result).toEqual({ name: "hero", file: path.join(folder, "hero.png"), copied: true, bytes: 6 });
        expect(fs.readFileSync(result.file, "utf8")).toBe("pixels");
    });

    it("leaves a file with the same bytes alone, not even touching its modification time", () => {
        writeStill("hero", "pixels");
        publishStill(outDir, "hero", folder);
        const file = path.join(folder, "hero.png");
        const past = new Date("2020-01-01T00:00:00Z");
        fs.utimesSync(file, past, past);
        const result = publishStill(outDir, "hero", folder);
        expect(result.copied).toBe(false);
        expect(fs.statSync(file).mtime.getTime()).toBe(past.getTime());
    });

    it("replaces a file whose bytes differ, also when only the length differs", () => {
        writeStill("hero", "new pixels");
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, "hero.png"), "new");
        expect(publishStill(outDir, "hero", folder).copied).toBe(true);
        expect(fs.readFileSync(path.join(folder, "hero.png"), "utf8")).toBe("new pixels");
    });

    it("leaves no temporary file behind, and keeps the old picture when the final rename fails", () => {
        writeStill("hero", "new pixels");
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, "hero.png"), "old");
        // The partial file is written first; the failure comes at the rename, so it exists when cleanup runs.
        const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
            throw new Error("disk full");
        });
        try {
            expect(() => publishStill(outDir, "hero", folder)).toThrow("disk full");
            expect(rename).toHaveBeenCalledTimes(1);
        } finally {
            rename.mockRestore();
        }
        expect(fs.readdirSync(folder)).toEqual(["hero.png"]);
        expect(fs.readFileSync(path.join(folder, "hero.png"), "utf8")).toBe("old");
    });

    it("fails for a still that is not there, naming the file", () => {
        expect(() => publishStill(outDir, "ghost", folder)).toThrow(/ENOENT.*ghost\.png/);
    });
});

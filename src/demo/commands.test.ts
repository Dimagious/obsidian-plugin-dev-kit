import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createContext, createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { BLUE, RED, writeFilm } from "../test-support/demo-films.js";
import { demoCommand, demoCommands } from "./commands.js";

let plugin: PluginFixture | undefined;
afterEach(() => {
    plugin?.cleanup();
    plugin = undefined;
});

describe("registration", () => {
    it("exposes demo", () => {
        expect(demoCommands.map((command) => command.name)).toEqual(["demo"]);
    });

    it("documents the outputs, the checks, ffmpeg and the config in its usage", () => {
        for (const text of ["Usage: opdk demo [film names...]", "<name>.mp4", "OPDK_FFMPEG", "phone-captions", "2 MB", "10 MB", "loop", "opdk.config.mjs", "No audio"]) {
            expect(demoCommand.usage).toContain(text);
        }
    });

    it("states the names, the folder, the checks and the exit codes the command really has", () => {
        for (const text of [
            "<name>-poster.png",
            "docs/screens",
            "preset slow",
            "the film's fps when lower",
            "pair      a -light or -dark film whose partner film is missing",
            'loop: "fail" makes it an error',
            "hold      ",
            "attached to issues and pull requests",
            "The command never deletes media",
            "Exit 1 when anything fails: no films, a name",
            "a missing ffmpeg",
        ]) {
            expect(demoCommand.usage).toContain(text);
        }
        expect(demoCommand.usage).not.toContain(".poster.png");
    });

    it("keeps typographic dashes out of the usage text", () => {
        expect(demoCommand.usage).not.toMatch(/[\u2013\u2014]/);
    });
});

describe("run", () => {
    it("rejects an option", async () => {
        plugin = createPluginFixture();
        await expect(demoCommand.run(["--fast"], createContext(plugin.dir))).rejects.toThrow('has no option "--fast"');
    });

    it("reads the demo section of opdk.config.mjs and reports a bad one with the file name", async () => {
        plugin = createPluginFixture();
        plugin.write("opdk.config.mjs", "export default { demo: { loop: 'sometimes' } };\n");
        await expect(demoCommand.run([], createContext(plugin.dir))).rejects.toThrow(/opdk\.config\.mjs: "demo\.loop" must be one of/);
    });

    it("fails with a hint when the plugin has recorded no films", async () => {
        plugin = createPluginFixture();
        const ctx = createContext(plugin.dir);
        expect(await demoCommand.run([], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("no films in");
    });

    it("works from the config's folders (the fixture default when none is set)", async () => {
        plugin = createPluginFixture();
        plugin.write("opdk.config.mjs", "export default { demo: { output: 'media' } };\n");
        writeFilm(path.join(plugin.dir, ".opdk", "demo"), { name: "incomplete", width: 20, height: 10, frames: [{ hold: 1, background: RED }, { hold: 1, background: BLUE }], complete: false });
        const ctx = createContext(plugin.dir, { OPDK_FFMPEG: path.join(os.tmpdir(), "opdk-no-such-ffmpeg") });
        // Only an incomplete film: nothing to encode, so ffmpeg is not needed and the run says why.
        expect(await demoCommand.run([], ctx)).toBe(1);
        expect(ctx.out.join("")).toMatch(/! demo +incomplete: skipped, its recording did not finish/);
        expect(fs.existsSync(path.join(plugin.dir, "media"))).toBe(false);
    });
});

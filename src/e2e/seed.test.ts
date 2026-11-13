import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySeed, resolveSeed, seedPathProblem, seedPluginFolder } from "./seed.js";

describe("resolveSeed", () => {
    it("treats no seed as an empty one", () => {
        expect(resolveSeed(undefined)).toEqual({});
        expect(resolveSeed({})).toEqual({});
    });

    it("keeps files and config", () => {
        expect(resolveSeed({ files: { "Notes/a.md": "# a" }, config: { propertiesInDocument: "hidden" } })).toEqual({
            files: { "Notes/a.md": "# a" },
            config: { propertiesInDocument: "hidden" },
        });
    });

    it("refuses what is not an object, naming the fix", () => {
        expect(() => resolveSeed("a.md")).toThrow(/^seed: must be an object \{ files\?, config\? \}/);
        expect(() => resolveSeed([])).toThrow(/must be an object/);
        expect(() => resolveSeed(null)).toThrow(/must be an object/);
    });

    it("refuses an unknown key, which is usually a typo", () => {
        expect(() => resolveSeed({ file: {} })).toThrow('seed: unknown key "file". Known keys: files, config.');
    });

    it("refuses files that are not path to text", () => {
        expect(() => resolveSeed({ files: ["a.md"] })).toThrow(/"files" must be an object/);
        expect(() => resolveSeed({ files: { "a.json": { a: 1 } } })).toThrow(/"files\["a\.json"\]" must be a string.*JSON\.stringify/);
    });

    it.each([
        ["", "is empty"],
        ["  ", "is empty"],
        ["/etc/passwd", "is absolute"],
        ["C:\\x.md", "is absolute"],
        ["Notes/", "names a folder"],
        ["../x.md", "leaves the vault"],
        ["a/../../x.md", "leaves the vault"],
        [".", "names the vault folder itself"],
        ["./", "names a folder"],
        ["./.", "names the vault folder itself"],
        [".obsidian", "names the .obsidian folder itself"],
        ["./.obsidian", "names the .obsidian folder itself"],
        [".Obsidian", "names the .obsidian folder itself"],
        [".obsidian/.", "names the .obsidian folder itself"],
        [".obsidian\\.", "names the .obsidian folder itself"],
    ])("refuses the path %j", (file, problem) => {
        expect(() => resolveSeed({ files: { [file]: "x" } })).toThrow(new RegExp(problem));
    });

    it.each([
        [".obsidian/app.json", /files\["\.obsidian\/app\.json"\] would replace \.obsidian\/app\.json.*seed\.config/],
        ["./.obsidian/app.json", /seed\.config/],
        [".obsidian\\app.json", /seed\.config/],
        [".obsidian/./APP.json", /seed\.config/],
        [".obsidian/community-plugins.json", /community-plugins\.json.*plugins option/],
        [".obsidian/plugins/my-plugin/data.json", /plugin's data\.json.*data option/],
    ])("refuses %j, which would replace what the kit writes, and names the key to use", (file, message) => {
        expect(() => resolveSeed({ files: { [file]: "{}" } })).toThrow(message);
    });

    it("still accepts the other files of .obsidian", () => {
        expect(() => resolveSeed({ files: { ".obsidian/templates.json": "{}", ".obsidian/plugins/x/notes.md": "x", "app.json": "{}" } })).not.toThrow();
    });

    it("refuses config that is not an object", () => {
        expect(() => resolveSeed({ config: "x" })).toThrow(/"config" must be an object of app\.json keys/);
    });
});

describe("seedPluginFolder", () => {
    it("finds the installed plugin whose folder holds the file, ignoring case and slash style", () => {
        expect(seedPluginFolder(".obsidian/plugins/my-plugin/main.js", ["my-plugin"])).toBe("my-plugin");
        expect(seedPluginFolder(".obsidian\\plugins\\My-Plugin\\x.css", ["my-plugin"])).toBe("my-plugin");
        expect(seedPluginFolder(".obsidian/plugins/other/main.js", ["my-plugin"])).toBeNull();
        expect(seedPluginFolder("Notes/main.js", ["my-plugin"])).toBeNull();
    });
});

describe("seedPathProblem", () => {
    it("accepts a nested path and a hidden folder", () => {
        expect(seedPathProblem("Notes/a.md")).toBeNull();
        expect(seedPathProblem(".obsidian/templates.json")).toBeNull();
        expect(seedPathProblem("a..b.md")).toBeNull();
    });
});

describe("applySeed", () => {
    let vaultPath: string;

    beforeEach(() => {
        vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-seed-test-"));
        fs.mkdirSync(path.join(vaultPath, ".obsidian"));
        fs.writeFileSync(path.join(vaultPath, "Welcome.md"), "# seed vault");
        fs.writeFileSync(path.join(vaultPath, ".obsidian", "app.json"), JSON.stringify({ settingsPopoutWindow: false, keep: 1 }));
    });

    afterEach(() => {
        fs.rmSync(vaultPath, { recursive: true, force: true });
    });

    it("writes files, creating folders, and replaces a file of the seed vault", () => {
        applySeed(vaultPath, { files: { "Notes/deep/a.md": "# a", "Welcome.md": "# replaced", ".obsidian/templates.json": '{"folder":"T"}' } });
        expect(fs.readFileSync(path.join(vaultPath, "Notes", "deep", "a.md"), "utf8")).toBe("# a");
        expect(fs.readFileSync(path.join(vaultPath, "Welcome.md"), "utf8")).toBe("# replaced");
        expect(fs.readFileSync(path.join(vaultPath, ".obsidian", "templates.json"), "utf8")).toBe('{"folder":"T"}');
    });

    it("merges config into app.json over what is there and keeps the other keys", () => {
        applySeed(vaultPath, { config: { propertiesInDocument: "hidden", settingsPopoutWindow: true } });
        expect(JSON.parse(fs.readFileSync(path.join(vaultPath, ".obsidian", "app.json"), "utf8"))).toEqual({
            alwaysUpdateLinks: true,
            settingsPopoutWindow: true,
            keep: 1,
            propertiesInDocument: "hidden",
        });
    });

    it("creates app.json when the vault has none", () => {
        fs.rmSync(path.join(vaultPath, ".obsidian", "app.json"));
        applySeed(vaultPath, { config: { a: 1 } });
        expect(JSON.parse(fs.readFileSync(path.join(vaultPath, ".obsidian", "app.json"), "utf8"))).toMatchObject({ a: 1 });
    });

    it("leaves app.json alone for an empty seed or an empty config", () => {
        const before = fs.readFileSync(path.join(vaultPath, ".obsidian", "app.json"), "utf8");
        applySeed(vaultPath, {});
        applySeed(vaultPath, { config: {} });
        expect(fs.readFileSync(path.join(vaultPath, ".obsidian", "app.json"), "utf8")).toBe(before);
    });

    it("refuses a file in the folder of an installed plugin before writing anything", () => {
        expect(() => {
            applySeed(vaultPath, { files: { "Notes/a.md": "# a", ".obsidian/plugins/my-plugin/main.js": "x" } }, ["my-plugin"]);
        }).toThrow(/inside the folder of the installed plugin "my-plugin".*data option/);
        expect(fs.existsSync(path.join(vaultPath, "Notes"))).toBe(false);
        // A folder of a plugin that is not installed is just a folder.
        applySeed(vaultPath, { files: { ".obsidian/plugins/other/notes.txt": "x" } }, ["my-plugin"]);
        expect(fs.existsSync(path.join(vaultPath, ".obsidian", "plugins", "other", "notes.txt"))).toBe(true);
    });

    it("refuses a path that leaves the vault and writes nothing outside", () => {
        expect(() => {
            applySeed(vaultPath, { files: { "../escape.md": "x" } });
        }).toThrow(/outside the vault/);
        expect(fs.existsSync(path.join(path.dirname(vaultPath), "escape.md"))).toBe(false);
    });
});

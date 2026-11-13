import { afterEach, describe, expect, it } from "vitest";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { loadWorkflows } from "./files.js";

let plugin: PluginFixture | undefined;
afterEach(() => {
    plugin?.cleanup();
    plugin = undefined;
});

describe("loadWorkflows", () => {
    it("returns the .yml and .yaml files sorted by name, and nothing else", () => {
        plugin = createPluginFixture();
        plugin.write(".github/workflows/release.yml", "b");
        plugin.write(".github/workflows/ci.yaml", "a");
        plugin.write(".github/workflows/README.md", "ignored");
        plugin.write(".github/workflows/notes.yml.bak", "ignored");
        expect(loadWorkflows(plugin.dir)).toEqual([
            { file: ".github/workflows/ci.yaml", text: "a" },
            { file: ".github/workflows/release.yml", text: "b" },
        ]);
    });

    it("returns nothing for a plugin without workflows, or where .github is a file", () => {
        plugin = createPluginFixture();
        expect(loadWorkflows(plugin.dir)).toEqual([]);
        plugin.write(".github", "not a folder");
        expect(loadWorkflows(plugin.dir)).toEqual([]);
    });
});

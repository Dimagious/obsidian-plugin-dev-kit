import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import {
    assertBuildFresh,
    assertDataIdsInstalled,
    assertUniqueIds,
    installPlugin,
    newestSourceFile,
    readPluginSource,
    writeCommunityPlugins,
    writePluginData,
} from "./plugins.js";

let plugin: PluginFixture;
let vault: PluginFixture;

beforeEach(() => {
    plugin = createPluginFixture({ id: "my-plugin" });
    vault = createPluginFixture();
});

afterEach(() => {
    plugin.cleanup();
    vault.cleanup();
});

const touch = (file: string, secondsAgo: number): void => {
    const time = new Date(Date.now() - secondsAgo * 1000);
    fs.utimesSync(file, time, time);
};

describe("readPluginSource", () => {
    it("reads the id from manifest.json and finds the build output", () => {
        plugin.write("main.js", "//js");
        plugin.write("styles.css", "/*css*/");
        const source = readPluginSource(plugin.dir);
        expect(source.id).toBe("my-plugin");
        expect(source.mainJs).toBe(path.join(plugin.dir, "main.js"));
        expect(source.stylesCss).toBe(path.join(plugin.dir, "styles.css"));
    });

    it("treats styles.css as optional", () => {
        plugin.write("main.js", "//js");
        expect(readPluginSource(plugin.dir).stylesCss).toBeUndefined();
    });

    it("tells you to build when main.js is missing", () => {
        expect(() => readPluginSource(plugin.dir)).toThrow(/Plugin "my-plugin" has no built main\.js in .*Run `opdk build` there first/);
    });

    it("fails with the manifest error when there is no manifest.json", () => {
        fs.rmSync(path.join(plugin.dir, "manifest.json"));
        expect(() => readPluginSource(plugin.dir)).toThrow(/No manifest\.json/);
    });
});

describe("assertUniqueIds and assertDataIdsInstalled", () => {
    const source = (id: string, dir: string) => ({ id, dir, mainJs: "", manifestJson: "", stylesCss: undefined });

    it("rejects two plugins with one id", () => {
        expect(() => {
            assertUniqueIds([source("a", "/one"), source("b", "/two"), source("a", "/three")]);
        }).toThrow('Plugins /one and /three both have the id "a"');
    });

    it("accepts distinct ids", () => {
        expect(() => {
            assertUniqueIds([source("a", "/one"), source("b", "/two")]);
        }).not.toThrow();
    });

    it("rejects data for a plugin that is not installed, listing the installed ones", () => {
        expect(() => {
            assertDataIdsInstalled({ typo: {} }, [source("a", "/one"), source("b", "/two")]);
        }).toThrow('entry for "typo", but the installed plugins are: a, b');
    });

    it("accepts data for installed plugins and no data", () => {
        expect(() => {
            assertDataIdsInstalled({ a: {} }, [source("a", "/one")]);
        }).not.toThrow();
        expect(() => {
            assertDataIdsInstalled({}, [source("a", "/one")]);
        }).not.toThrow();
    });
});

describe("newestSourceFile", () => {
    it("is undefined without a src folder", () => {
        expect(newestSourceFile(plugin.dir)).toBeUndefined();
    });

    it("is undefined for an empty src folder", () => {
        fs.mkdirSync(path.join(plugin.dir, "src"));
        expect(newestSourceFile(plugin.dir)).toBeUndefined();
    });

    it("finds the newest file at any depth and ignores test files", () => {
        plugin.write("src/a.ts", "a");
        plugin.write("src/deep/b.ts", "b");
        plugin.write("src/deep/b.test.ts", "t");
        plugin.write("src/c.spec.tsx", "t");
        touch(path.join(plugin.dir, "src/a.ts"), 100);
        touch(path.join(plugin.dir, "src/deep/b.ts"), 50);
        touch(path.join(plugin.dir, "src/deep/b.test.ts"), 1);
        touch(path.join(plugin.dir, "src/c.spec.tsx"), 1);
        expect(newestSourceFile(plugin.dir)?.file).toBe(path.join(plugin.dir, "src/deep/b.ts"));
    });
});

describe("assertBuildFresh", () => {
    it("accepts a main.js newer than every source file", () => {
        plugin.write("src/main.ts", "x");
        plugin.write("main.js", "x");
        touch(path.join(plugin.dir, "src/main.ts"), 60);
        expect(() => {
            assertBuildFresh(readPluginSource(plugin.dir));
        }).not.toThrow();
    });

    it("rejects a main.js older than a source file and says how to fix it", () => {
        plugin.write("src/util/late.ts", "x");
        plugin.write("main.js", "x");
        touch(path.join(plugin.dir, "main.js"), 60);
        expect(() => {
            assertBuildFresh(readPluginSource(plugin.dir));
        }).toThrow(/Stale build: main\.js of "my-plugin" .* is older than src\/util\/late\.ts .*opdk build.*plugins option.*OPDK_E2E_ALLOW_STALE_BUILD=1/s);
    });

    it("ignores a newer test file", () => {
        plugin.write("src/main.ts", "x");
        plugin.write("src/main.test.ts", "x");
        plugin.write("main.js", "x");
        touch(path.join(plugin.dir, "src/main.ts"), 120);
        touch(path.join(plugin.dir, "main.js"), 60);
        touch(path.join(plugin.dir, "src/main.test.ts"), 1);
        expect(() => {
            assertBuildFresh(readPluginSource(plugin.dir));
        }).not.toThrow();
    });

    it("does not check a prebuilt folder without src", () => {
        plugin.write("main.js", "x");
        expect(() => {
            assertBuildFresh(readPluginSource(plugin.dir));
        }).not.toThrow();
    });
});

describe("installPlugin", () => {
    it("copies main.js, manifest.json and styles.css into the plugin folder", () => {
        plugin.write("main.js", "//js");
        plugin.write("styles.css", "/*css*/");
        installPlugin(vault.dir, readPluginSource(plugin.dir));
        const target = path.join(vault.dir, ".obsidian", "plugins", "my-plugin");
        expect(fs.readFileSync(path.join(target, "main.js"), "utf8")).toBe("//js");
        expect(fs.readFileSync(path.join(target, "styles.css"), "utf8")).toBe("/*css*/");
        expect(JSON.parse(fs.readFileSync(path.join(target, "manifest.json"), "utf8"))).toMatchObject({ id: "my-plugin" });
    });

    it("skips styles.css when the plugin has none and keeps other files already there", () => {
        plugin.write("main.js", "//js");
        vault.write(".obsidian/plugins/my-plugin/data.json", '{"seed":true}');
        installPlugin(vault.dir, readPluginSource(plugin.dir));
        const target = path.join(vault.dir, ".obsidian", "plugins", "my-plugin");
        expect(fs.existsSync(path.join(target, "styles.css"))).toBe(false);
        expect(fs.readFileSync(path.join(target, "data.json"), "utf8")).toBe('{"seed":true}');
    });
});

describe("writeCommunityPlugins", () => {
    const file = (): string => path.join(vault.dir, ".obsidian", "community-plugins.json");

    it("creates the list", () => {
        expect(writeCommunityPlugins(vault.dir, ["a", "b"])).toEqual(["a", "b"]);
        expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toEqual(["a", "b"]);
    });

    it("keeps what the seed vault already enables, without duplicates", () => {
        vault.write(".obsidian/community-plugins.json", '["seeded","a"]');
        expect(writeCommunityPlugins(vault.dir, ["a", "b"])).toEqual(["seeded", "a", "b"]);
    });

    it("rejects a list that is not JSON or not an array of strings", () => {
        vault.write(".obsidian/community-plugins.json", "{nope");
        expect(() => writeCommunityPlugins(vault.dir, ["a"])).toThrow(/is not valid JSON/);
        vault.write(".obsidian/community-plugins.json", '{"a":1}');
        expect(() => writeCommunityPlugins(vault.dir, ["a"])).toThrow(/must be a JSON array of plugin ids/);
        vault.write(".obsidian/community-plugins.json", "[1]");
        expect(() => writeCommunityPlugins(vault.dir, ["a"])).toThrow(/must be a JSON array of plugin ids/);
    });
});

describe("writePluginData", () => {
    it("writes data.json and replaces the seed's", () => {
        vault.write(".obsidian/plugins/a/data.json", '{"old":1}');
        writePluginData(vault.dir, "a", { units: "metric" });
        expect(JSON.parse(fs.readFileSync(path.join(vault.dir, ".obsidian/plugins/a/data.json"), "utf8"))).toEqual({
            units: "metric",
        });
    });
});

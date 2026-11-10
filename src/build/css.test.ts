import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { buildCss, fileStamp } from "./css.js";

describe("buildCss", () => {
    let plugin: PluginFixture;
    beforeEach(() => {
        plugin = createPluginFixture();
    });
    afterEach(() => {
        plugin.cleanup();
    });
    const css = { entry: "src/styles/main.css", outfile: "styles.css" };

    it("writes the bundled stylesheet and reports file and line counts", () => {
        plugin.write("src/styles/main.css", '@import "./a.css";\n@import "./nested/b.css";\n');
        plugin.write("src/styles/a.css", ".a{}");
        plugin.write("src/styles/nested/b.css", '@import "../c.css";\n.b{}');
        plugin.write("src/styles/c.css", ".c{}");
        const result = buildCss(plugin.dir, css);
        expect(result).toMatchObject({ status: "built", files: 4 });
        // The entry first, then the imports in the order they were read.
        expect(result.status === "built" && result.inputs.map((file) => path.relative(plugin.dir, file))).toEqual([
            "src/styles/main.css",
            "src/styles/a.css",
            "src/styles/nested/b.css",
            "src/styles/c.css",
        ]);
        expect(readFileSync(path.join(plugin.dir, "styles.css"), "utf8")).toBe(".a{}\n.c{}\n.b{}\n");
    });

    it("reports no-entry and leaves a hand-written styles.css alone", () => {
        plugin.write("styles.css", ".hand{}");
        expect(buildCss(plugin.dir, css)).toEqual({ status: "no-entry" });
        expect(readFileSync(path.join(plugin.dir, "styles.css"), "utf8")).toBe(".hand{}");
    });

    it("honours custom entry and outfile, creating the output folder", () => {
        plugin.write("css/app.css", ".app{}");
        buildCss(plugin.dir, { entry: "css/app.css", outfile: "out/styles.css" });
        expect(readFileSync(path.join(plugin.dir, "out/styles.css"), "utf8")).toBe(".app{}");
    });

    it("throws on a missing import without writing the output", () => {
        plugin.write("src/styles/main.css", '@import "./gone.css";');
        expect(() => buildCss(plugin.dir, css)).toThrow("gone.css");
        expect(() => readFileSync(path.join(plugin.dir, "styles.css"))).toThrow();
    });

    it("reports each looked-up file with a stamp taken before its read, also on a failing run", () => {
        plugin.write("src/styles/main.css", '@import "./a.css";\n@import "./gone.css";\n');
        plugin.write("src/styles/a.css", ".a{}");
        const seen = new Map<string, string | undefined>();
        expect(() => buildCss(plugin.dir, css, (file, stamp) => seen.set(path.relative(plugin.dir, file), stamp))).toThrow("gone.css");
        expect(seen.get("src/styles/main.css")).toBe(fileStamp(path.join(plugin.dir, "src/styles/main.css")));
        expect(seen.get("src/styles/a.css")).toBe(fileStamp(path.join(plugin.dir, "src/styles/a.css")));
        expect(seen.has("src/styles/gone.css")).toBe(true);
        expect(seen.get("src/styles/gone.css")).toBeUndefined();
    });
});

describe("fileStamp", () => {
    let plugin: PluginFixture;
    beforeEach(() => {
        plugin = createPluginFixture();
    });
    afterEach(() => {
        plugin.cleanup();
    });

    it("changes when the content size changes and is undefined for a missing file or a missing folder", () => {
        plugin.write("a.css", ".a{}");
        const file = path.join(plugin.dir, "a.css");
        const before = fileStamp(file);
        expect(before).toBeTypeOf("string");
        plugin.write("a.css", ".a{color:red}");
        expect(fileStamp(file)).not.toBe(before);
        expect(fileStamp(path.join(plugin.dir, "nope.css"))).toBeUndefined();
        expect(fileStamp(path.join(file, "inside-a-file.css"))).toBeUndefined();
    });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { buildCss } from "./css.js";

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
});

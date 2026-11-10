import path from "node:path";
import { describe, expect, it } from "vitest";
import { CssImportError, inlineImports } from "./css-imports.js";

const root = path.resolve("/styles");
const at = (name: string): string => path.join(root, name);

function reader(files: Record<string, string>): (file: string) => string | undefined {
    return (file) => files[path.relative(root, file)];
}

describe("inlineImports", () => {
    it("returns a file without imports unchanged", () => {
        const result = inlineImports(at("main.css"), reader({ "main.css": "a { b: c }" }));
        expect(result).toEqual({ css: "a { b: c }", files: [at("main.css")] });
    });

    it("inlines imports in place, with or without a semicolon and with either quote", () => {
        const files = { "main.css": '@import "a.css";\n@import \'b.css\'\n.x{}', "a.css": ".a{}", "b.css": ".b{}" };
        expect(inlineImports(at("main.css"), reader(files)).css).toBe(".a{}\n.b{}\n.x{}");
    });

    it("resolves nested imports relative to the importing file", () => {
        const files = {
            "main.css": '@import "blocks/index.css";',
            "blocks/index.css": '@import "chart.css";\n.index{}',
            "blocks/chart.css": '@import "../base.css";\n.chart{}',
            "base.css": ".base{}",
        };
        const result = inlineImports(at("main.css"), reader(files));
        expect(result.css).toBe(".base{}\n.chart{}\n.index{}");
        expect(result.files.map((file) => path.relative(root, file))).toEqual([
            "main.css",
            path.join("blocks", "index.css"),
            path.join("blocks", "chart.css"),
            "base.css",
        ]);
    });

    it("allows the same file to be imported twice (not a cycle)", () => {
        const files = {
            "main.css": '@import "a.css";@import "b.css";',
            "a.css": '@import "c.css";',
            "b.css": '@import "c.css";',
            "c.css": ".c{}",
        };
        expect(inlineImports(at("main.css"), reader(files)).css).toBe(".c{}.c{}");
    });

    it("fails on a missing import and names the importing file", () => {
        const files = { "main.css": '@import "gone.css";' };
        expect(() => inlineImports(at("main.css"), reader(files))).toThrow(
            `${at("main.css")}: @import "gone.css" not found`,
        );
    });

    it("names the nested importer when the missing import is deeper", () => {
        const files = { "main.css": '@import "a.css";', "a.css": '@import "gone.css";' };
        expect(() => inlineImports(at("main.css"), reader(files))).toThrow(
            `${at("a.css")}: @import "gone.css" not found`,
        );
    });

    it("fails when the entry itself is missing", () => {
        expect(() => inlineImports(at("main.css"), reader({}))).toThrow("CSS file not found");
    });

    it("fails on an import cycle and prints the chain", () => {
        const files = { "main.css": '@import "a.css";', "a.css": '@import "b.css";', "b.css": '@import "a.css";' };
        expect(() => inlineImports(at("main.css"), reader(files))).toThrow(
            `CSS import cycle: ${at("main.css")} -> ${at("a.css")} -> ${at("b.css")} -> ${at("a.css")}`,
        );
    });

    it("fails when a file imports itself", () => {
        expect(() => inlineImports(at("main.css"), reader({ "main.css": '@import "main.css";' }))).toThrow(
            "CSS import cycle",
        );
    });

    it("lists the files read before a failure on the error, for --watch to poll", () => {
        const failure = (files: Record<string, string>): CssImportError => {
            try {
                inlineImports(at("main.css"), reader(files));
            } catch (error) {
                if (error instanceof CssImportError) {
                    return error;
                }
                throw error;
            }
            throw new Error("expected inlineImports to fail");
        };
        // b.css is read completely before the broken a.css, so the list is "files read so far", not the import chain.
        const missing = failure({ "main.css": '@import "b.css";@import "a.css";', "a.css": '@import "gone.css";', "b.css": "" });
        expect(missing.files).toEqual([at("main.css"), at("b.css"), at("a.css")]);

        const cycle = failure({ "main.css": '@import "a.css";', "a.css": '@import "main.css";' });
        expect(cycle.files).toEqual([at("main.css"), at("a.css")]);

        expect(failure({}).files).toEqual([]);
    });

    it("leaves URL imports for the browser", () => {
        const css = '@import "https://fonts.example/x.css";\n.a{}';
        expect(inlineImports(at("main.css"), reader({ "main.css": css })).css).toBe(css);
    });
});

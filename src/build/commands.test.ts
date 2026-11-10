import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { build as esbuild } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { assertBundleCommand, buildCommand, buildCommands, buildCssCommand } from "./commands.js";
import { CJS_FOOTER } from "./options.js";
import { findNodeOnlyReferences } from "./bundle-check.js";

// Real ESLint, git and esbuild runs: they miss the 5 s default when suites share the machine. Per file, so the global default stays.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const MAIN_TS = 'export default class FixturePlugin {\n    hello(): string {\n        return "hello from fixture";\n    }\n}\n';

let plugin: PluginFixture;
const read = (relativePath: string): string => readFileSync(path.join(plugin.dir, relativePath), "utf8");

function ordinaryPlugin(manifest: Record<string, unknown> = {}): void {
    plugin = createPluginFixture(manifest);
    plugin.write("src/main.ts", MAIN_TS);
    plugin.write("src/styles/main.css", '@import "./base.css";\n.fixture { color: red; }\n');
    plugin.write("src/styles/base.css", ".base { margin: 0; }\n");
}

afterEach(() => {
    plugin.cleanup();
});

describe("registration", () => {
    beforeEach(() => {
        ordinaryPlugin();
    });

    it("exposes build, build-css and assert-bundle", () => {
        expect(buildCommands.map((command) => command.name)).toEqual(["build", "build-css", "assert-bundle"]);
    });
});

describe("opdk build", () => {
    beforeEach(() => {
        ordinaryPlugin();
    });

    it("bundles a minified browser cjs main.js with the footer, builds styles.css and checks the bundle", async () => {
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run([], ctx)).toBe(0);

        const main = read("main.js");
        expect(main).toContain("hello from fixture");
        expect(main.trimEnd().endsWith(CJS_FOOTER)).toBe(true);
        expect(main.split("\n").length).toBeLessThan(6);
        expect(read("styles.css")).toBe(".base { margin: 0; }\n\n.fixture { color: red; }\n");

        const out = ctx.out.join("");
        expect(out).toContain("· build   fixture-plugin: bundling src/main.ts");
        expect(out).toContain("✓ css     src/styles/main.css -> styles.css (2 files, 4 lines)");
        expect(out).toMatch(/✓ build {3}fixture-plugin: main\.js \d+\.\d KiB/);
        expect(out).toContain("✓ bundle  main.js is free of Node-only references");
        expect(ctx.err).toEqual([]);
    });

    it("lists the steps in the order they run in its usage", () => {
        const usage = buildCommand.usage;
        expect(usage.indexOf("Builds the CSS")).toBeGreaterThan(-1);
        expect(usage.indexOf("Builds the CSS")).toBeLessThan(usage.indexOf("bundles the plugin"));
        expect(usage.indexOf("bundles the plugin")).toBeLessThan(usage.indexOf("checks main.js"));
    });

    it("prints the CSS line before the bundling line, in execution order", async () => {
        const ctx = createContext(plugin.dir);
        await buildCommand.run([], ctx);
        const out = ctx.out.join("");
        expect(out.indexOf("✓ css")).toBeGreaterThanOrEqual(0);
        expect(out.indexOf("✓ css")).toBeLessThan(out.indexOf("bundling"));
    });

    it("prints esbuild warnings to stderr and still exits 0", async () => {
        plugin.write("src/main.ts", "export default { a: 1, a: 2 };\n");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run([], ctx)).toBe(0);
        expect(ctx.err.join("")).toContain('Duplicate key "a"');
    });

    it("documents --force and --vault=<dir> in its usage", () => {
        expect(buildCommand.usage).toContain("--force");
        expect(buildCommand.usage).toContain("--vault=<dir>");
    });

    it("does not minify when build.minify is false", async () => {
        plugin.write("opdk.config.mjs", "export default { build: { minify: false } };\n");
        await buildCommand.run([], createContext(plugin.dir));
        expect(read("main.js")).toContain("  hello() {");
    });

    it("keeps a hand-written styles.css when there is no CSS entry", async () => {
        plugin.write("styles.css", ".hand-written{}");
        // Point the config at an entry that does not exist, as in a plugin without src/styles.
        plugin.write("opdk.config.mjs", 'export default { build: { css: { entry: "src/nope/main.css" } } };\n');
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run([], ctx)).toBe(0);
        expect(read("styles.css")).toBe(".hand-written{}");
        expect(ctx.out.join("")).toContain("· css     no src/nope/main.css, keeping styles.css as is");
        expect(ctx.out.join("")).not.toContain("! css");
    });

    it("warns when there is neither a CSS entry nor a styles.css", async () => {
        plugin.write("opdk.config.mjs", 'export default { build: { css: { entry: "src/nope/main.css" } } };\n');
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run([], ctx)).toBe(0);
        expect(ctx.out.join("")).toContain("! css     no src/nope/main.css and no styles.css, the plugin ships no stylesheet");
    });

    it("skips the CSS step with build.css: false", async () => {
        plugin.write("opdk.config.mjs", "export default { build: { css: false } };\n");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run([], ctx)).toBe(0);
        expect(existsSync(path.join(plugin.dir, "styles.css"))).toBe(false);
        expect(ctx.out.join("")).not.toContain("css ");
    });

    it("applies loaders, extra externals and a custom entry and outfile from the config", async () => {
        plugin.write("opdk.config.mjs",
            'export default { build: { entry: "src/index.ts", outfile: "out/main.js", loader: { ".png": "dataurl" }, external: ["left-out"], css: false } };\n');
        plugin.write("src/index.ts", 'import img from "./logo.png";\nimport "left-out";\nexport default img;\n');
        plugin.write("src/logo.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(await buildCommand.run([], createContext(plugin.dir))).toBe(0);
        const main = read("out/main.js");
        expect(main).toContain("data:image/png;base64,");
        expect(main).toContain('require("left-out")');
    });

    it("bundles an imported .css file as a string by default", async () => {
        plugin.write("src/main.ts", 'import css from "./inline.css";\nexport default class P { css = css; }\n');
        plugin.write("src/inline.css", ".inline-marker { color: red; }\n");
        expect(await buildCommand.run([], createContext(plugin.dir))).toBe(0);
        expect(read("main.js")).toContain(".inline-marker");
    });

    it("keeps obsidian and the CodeMirror packages external", async () => {
        plugin.write("src/main.ts", 'import { Plugin } from "obsidian";\nimport { EditorView } from "@codemirror/view";\nexport default class P extends Plugin { v = EditorView; }\n');
        expect(await buildCommand.run([], createContext(plugin.dir))).toBe(0);
        const main = read("main.js");
        expect(main).toContain('require("obsidian")');
        expect(main).toContain('require("@codemirror/view")');
    });

    it("exits 1 and prints esbuild's errors on a compile error", async () => {
        plugin.write("src/main.ts", "export default class {");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run([], ctx)).toBe(1);
        const err = ctx.err.join("");
        expect(err).toContain("src/main.ts");
        expect(
            err.endsWith(
                "✗ build   fixture-plugin: build failed with 1 error(s).\n          Fix them and rerun `opdk build`.\n",
            ),
        ).toBe(true);
        expect(existsSync(path.join(plugin.dir, "main.js"))).toBe(false);
    });

    it("exits 1 when the bundle contains Node-only code", async () => {
        plugin.write("src/main.ts", "export default class P { dir = process.env.HOME; }\n");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run([], ctx)).toBe(1);
        const err = ctx.err.join("");
        expect(err).toContain("✗ bundle  main.js cannot run on mobile:");
        expect(err).toContain("a `process` reference");
        expect(err).toBe(
            [
                "✗ bundle  main.js cannot run on mobile:",
                '            - a `process` reference: "process.env"',
                "          Check the esbuild platform: an Obsidian plugin bundles as `browser`.",
                "",
            ].join("\n"),
        );
        expect(ctx.out.join("")).not.toContain("✗");
    });

    it("says '1 file, 1 line' in the singular", async () => {
        plugin.write("src/styles/main.css", ".only{}");
        const ctx = createContext(plugin.dir);
        await buildCssCommand.run([], ctx);
        expect(ctx.out.join("")).toBe("✓ css     src/styles/main.css -> styles.css (1 file, 1 line)\n");
    });

    it("skips the bundle check for a desktop-only plugin", async () => {
        plugin.cleanup();
        ordinaryPlugin({ isDesktopOnly: true });
        plugin.write("src/main.ts", "export default class P { dir = process.env.HOME; }\n");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run([], ctx)).toBe(0);
        expect(ctx.out.join("")).toContain("desktop only");
    });

    it("fails on a missing CSS import and names the importing file", async () => {
        plugin.write("src/styles/main.css", '@import "./gone.css";');
        await expect(buildCommand.run([], createContext(plugin.dir))).rejects.toThrow("main.css: @import \"./gone.css\" not found");
    });

    it("fails clearly outside a plugin folder", async () => {
        plugin.write("manifest.json", "{");
        await expect(buildCommand.run([], createContext(plugin.dir))).rejects.toThrow("not valid JSON");
    });

    it("rejects an invalid config before building", async () => {
        plugin.write("opdk.config.mjs", "export default { build: { minify: 1 } };\n");
        await expect(buildCommand.run([], createContext(plugin.dir))).rejects.toThrow('"build.minify" must be true or false');
        expect(existsSync(path.join(plugin.dir, "main.js"))).toBe(false);
    });

    it("rejects unknown arguments", async () => {
        await expect(buildCommand.run(["--wat"], createContext(plugin.dir))).rejects.toThrow("Unknown argument");
    });
});

describe("the Dashy 1.0.0 incident: a dependency with node and default export conditions", () => {
    beforeEach(() => {
        ordinaryPlugin();
        plugin.write(
            "node_modules/dual/package.json",
            JSON.stringify({ name: "dual", version: "1.0.0", exports: { ".": { node: "./node.js", default: "./browser.js" } } }),
        );
        plugin.write("node_modules/dual/node.js", "exports.token = process.env.LOG_TOKENS;\n");
        plugin.write("node_modules/dual/browser.js", 'exports.token = "browser build";\n');
        plugin.write("src/main.ts", 'import { token } from "dual";\nexport default class P { token = token; }\n');
    });

    it("opdk build picks the default branch and passes the check", async () => {
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run([], ctx)).toBe(0);
        const main = read("main.js");
        expect(main).toContain("browser build");
        expect(main).not.toContain("LOG_TOKENS");
    });

    it("the same project bundled for platform node fails assert-bundle", async () => {
        await esbuild({
            absWorkingDir: plugin.dir,
            entryPoints: ["src/main.ts"],
            bundle: true,
            outfile: "node-main.js",
            platform: "node",
            format: "cjs",
            logLevel: "silent",
        });
        const nodeBuild = read("node-main.js");
        expect(findNodeOnlyReferences(nodeBuild).length).toBeGreaterThan(0);

        const ctx = createContext(plugin.dir);
        expect(await assertBundleCommand.run(["node-main.js"], ctx)).toBe(1);
        const err = ctx.err.join("");
        expect(err).toContain("✗ bundle  node-main.js cannot run on mobile:");
        expect(err).toContain("`LOG_TOKENS`, which only the Node build of a dependency contains");
    });
});

describe("opdk assert-bundle", () => {
    beforeEach(() => {
        ordinaryPlugin();
    });

    it("checks the configured outfile by default", async () => {
        plugin.write("main.js", "module.exports = {};");
        const ctx = createContext(plugin.dir);
        expect(await assertBundleCommand.run([], ctx)).toBe(0);
        expect(ctx.out.join("")).toContain("✓ bundle  main.js is free of Node-only references (0.0 KiB)");
    });

    it("prints the absolute path for a file outside the plugin folder", async () => {
        const outside = createPluginFixture();
        try {
            outside.write("other.js", "module.exports = {};");
            const file = path.join(outside.dir, "other.js");
            const ctx = createContext(plugin.dir);
            expect(await assertBundleCommand.run([file], ctx)).toBe(0);
            expect(ctx.out.join("")).toContain(`✓ bundle  ${file} is free of Node-only references`);
        } finally {
            outside.cleanup();
        }
    });

    it("fails when the file is missing and says what to run", async () => {
        const ctx = createContext(plugin.dir);
        expect(await assertBundleCommand.run([], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("main.js is missing: run `opdk build` first");
    });

    it("is skipped for a desktop-only plugin even when the file is bad", async () => {
        plugin.cleanup();
        ordinaryPlugin({ isDesktopOnly: true });
        plugin.write("main.js", "process.env.X");
        const ctx = createContext(plugin.dir);
        expect(await assertBundleCommand.run([], ctx)).toBe(0);
        expect(ctx.out.join("")).toContain("desktop only");
    });

    it.each([["--bogus"], ["a.js", "b.js"]])("rejects the arguments %j", async (...args) => {
        await expect(assertBundleCommand.run(args, createContext(plugin.dir))).rejects.toThrow("Usage: opdk assert-bundle [file]");
    });
});

describe("opdk build-css", () => {
    beforeEach(() => {
        ordinaryPlugin();
    });

    it("writes styles.css", async () => {
        const ctx = createContext(plugin.dir);
        expect(await buildCssCommand.run([], ctx)).toBe(0);
        expect(read("styles.css")).toContain(".fixture");
        expect(ctx.out.join("")).toContain("✓ css     src/styles/main.css -> styles.css");
    });

    it("exits 1 when the entry does not exist", async () => {
        plugin.write("opdk.config.mjs", 'export default { build: { css: { entry: "css/nope.css" } } };\n');
        const ctx = createContext(plugin.dir);
        expect(await buildCssCommand.run([], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("Create css/nope.css");
        // The failure is the only message: no `· css` line claims styles.css is kept.
        expect(ctx.out.join("")).toBe("");
    });

    it("does nothing when css is disabled", async () => {
        plugin.write("opdk.config.mjs", "export default { build: { css: false } };\n");
        const ctx = createContext(plugin.dir);
        expect(await buildCssCommand.run([], ctx)).toBe(0);
        expect(ctx.out.join("")).toContain("disabled");
        expect(existsSync(path.join(plugin.dir, "styles.css"))).toBe(false);
    });

    it("fails on an import cycle", async () => {
        plugin.write("src/styles/base.css", '@import "./main.css";');
        await expect(buildCssCommand.run([], createContext(plugin.dir))).rejects.toThrow("CSS import cycle");
    });

    it("takes no arguments", async () => {
        await expect(buildCssCommand.run(["x"], createContext(plugin.dir))).rejects.toThrow("takes no arguments");
    });
});

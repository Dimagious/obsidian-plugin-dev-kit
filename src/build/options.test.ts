import path from "node:path";
import { describe, expect, it } from "vitest";
import { CJS_FOOTER, DEFAULT_EXTERNAL, resolveBuild, resolveVaultDir, toEsbuildOptions } from "./options.js";

describe("resolveBuild", () => {
    it("uses Dashy's release build as the defaults", () => {
        expect(resolveBuild(undefined)).toEqual({
            entry: "src/main.ts",
            outfile: "main.js",
            minify: true,
            target: "es2020",
            external: ["obsidian", "electron", "@codemirror/state", "@codemirror/view"],
            loader: { ".css": "text" },
            css: { entry: "src/styles/main.css", outfile: "styles.css" },
        });
    });

    it("treats an empty section like no section", () => {
        expect(resolveBuild({})).toEqual(resolveBuild(undefined));
    });

    it("adds extra externals to the defaults without duplicates", () => {
        const resolved = resolveBuild({ external: ["yaml", "obsidian"] });
        expect(resolved.external).toEqual([...DEFAULT_EXTERNAL, "yaml"]);
    });

    it("passes loaders, minify, target, entry and outfile through", () => {
        const resolved = resolveBuild({
            entry: "src/index.ts",
            outfile: "out.js",
            minify: false,
            target: "es2022",
            loader: { ".png": "dataurl" },
        });
        expect(resolved).toMatchObject({
            entry: "src/index.ts",
            outfile: "out.js",
            minify: false,
            target: "es2022",
            loader: { ".css": "text", ".png": "dataurl" },
        });
    });

    it("fills css defaults key by key", () => {
        expect(resolveBuild({ css: { entry: "css/app.css" } }).css).toEqual({
            entry: "css/app.css",
            outfile: "styles.css",
        });
    });

    it("keeps css: false", () => {
        expect(resolveBuild({ css: false }).css).toBe(false);
    });

    it("accepts a root-level css entry with the default outfile (watch polls files, so no output loop)", () => {
        expect(resolveBuild({ css: { entry: "main.css" } }).css).toEqual({ entry: "main.css", outfile: "styles.css" });
    });

    it("starts the loaders with .css as text and lets build.loader merge over it", () => {
        expect(resolveBuild(undefined).loader).toEqual({ ".css": "text" });
        expect(resolveBuild({ loader: { ".png": "dataurl" } }).loader).toEqual({ ".css": "text", ".png": "dataurl" });
        expect(resolveBuild({ loader: { ".css": "css" } }).loader).toEqual({ ".css": "css" });
    });
});

describe("toEsbuildOptions", () => {
    const cwd = path.resolve("/plugin");

    it("fixes platform browser, format cjs and the footer, and resolves paths against cwd", () => {
        const options = toEsbuildOptions(resolveBuild(undefined), cwd, { kind: "release" });
        expect(options).toMatchObject({
            absWorkingDir: cwd,
            entryPoints: [path.join(cwd, "src/main.ts")],
            outfile: path.join(cwd, "main.js"),
            bundle: true,
            minify: true,
            platform: "browser",
            format: "cjs",
            target: "es2020",
            footer: { js: CJS_FOOTER },
            external: [...DEFAULT_EXTERNAL],
        });
    });

    it("honours minify: false in a release build", () => {
        expect(toEsbuildOptions(resolveBuild({ minify: false }), cwd, { kind: "release" }).minify).toBe(false);
    });

    it("writes an unminified main.js into the vault folder, even when minify is on", () => {
        const options = toEsbuildOptions(resolveBuild({ minify: true }), cwd, { kind: "vault", dir: "/vault/plugin" });
        expect(options.minify).toBe(false);
        expect(options.outfile).toBe(path.resolve("/vault/plugin/main.js"));
        expect(options.platform).toBe("browser");
    });

    it("passes loaders to esbuild", () => {
        const options = toEsbuildOptions(resolveBuild({ loader: { ".png": "dataurl" } }), cwd, { kind: "release" });
        expect(options.loader).toEqual({ ".css": "text", ".png": "dataurl" });
    });
});

describe("resolveVaultDir", () => {
    it("prefers the flag", () => {
        expect(resolveVaultDir("/flag", { VAULT_PLUGIN: "/env" }, "x")).toEqual({ dir: "/flag", source: "flag" });
    });

    it("falls back to VAULT_PLUGIN", () => {
        expect(resolveVaultDir(undefined, { VAULT_PLUGIN: "/env" }, "x")).toEqual({ dir: "/env", source: "env" });
    });

    it.each([{}, { VAULT_PLUGIN: "" }])("fails with the plugin id in the example when nothing is set (%j)", (env) => {
        expect(() => resolveVaultDir(undefined, env, "my-plugin")).toThrow(
            /VAULT_PLUGIN="\/absolute\/path\/to\/vault\/\.obsidian\/plugins\/my-plugin"/,
        );
    });
});

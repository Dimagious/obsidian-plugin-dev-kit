import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { initRepo, trackAll } from "../test-support/git.js";
import { scanCommand, scanCommands } from "./commands.js";
import { runScan } from "./run.js";

// Real ESLint, git and esbuild runs: they miss the 5 s default when suites share the machine. Per file, so the global default stays.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const TSCONFIG = JSON.stringify({
    compilerOptions: { target: "ES2020", lib: ["ES2020", "DOM"], module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [] },
    include: ["src/**/*.ts"],
});
const CLEAN_TS = "export const greet = (name: string): string => `hello ${name}`;\n";

let created: PluginFixture | undefined;
afterEach(() => {
    created?.cleanup();
    created = undefined;
});

/** A plugin that passes every check; the tests add one problem each. Tracked in git once `files` are written. */
function cleanPlugin(manifest: Record<string, unknown> = {}): PluginFixture {
    const plugin = createPluginFixture({ description: "Greets people.", ...manifest });
    created = plugin;
    plugin.write("tsconfig.json", TSCONFIG);
    plugin.write("src/main.ts", CLEAN_TS);
    plugin.write("styles.css", ".fixture { color: red; }\n");
    return plugin;
}

describe("registration", () => {
    it("exposes scan", () => {
        expect(scanCommands.map((command) => command.name)).toEqual(["scan"]);
    });

    it("documents the checks, the git requirement and the exit code in its usage", () => {
        expect(scanCommand.usage).toContain("Usage: opdk scan");
        for (const word of ["lint", "css", "code", "meta", "git", "Exit 1 on any failing finding"]) {
            expect(scanCommand.usage).toContain(word);
        }
    });
});

describe("opdk scan", () => {
    it("exits 0 and prints a ✓ per check on a clean plugin", async () => {
        const plugin = cleanPlugin();
        trackAll(plugin.dir);
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(0);
        const out = ctx.out.join("");
        expect(out).toContain("· scan    fixture-plugin: 4 tracked files");
        expect(out).toMatch(/✓ lint {4}0 findings \(\d+ files?, eslint-plugin-obsidianmd 0\.5\.1\)/);
        expect(out).toContain("✓ css     0 findings (1 file)");
        expect(out).toContain("✓ code    0 findings (1 file)");
        expect(out).toContain("✓ meta    0 findings (manifest.json)");
        expect(out).toContain("✓ scan    fixture-plugin: 0 findings in 4 tracked files");
        expect(ctx.err).toEqual([]);
    });

    it("exits 1 with file:line rule message for each kind of finding, grouped by check", async () => {
        const plugin = cleanPlugin({ description: "Fixture plugin does things." });
        plugin.write("src/main.ts", ['export const a = (): void => {', "    setTimeout(() => undefined, 1);", "};", 'export const host = ["forum", "obsidian", "md"].join(".");', ""].join("\n"));
        plugin.write("styles.css", ".a { color: red !important; }\n.b:has(.c) { margin: 0; }\n");
        plugin.write("site/extra.css", ".d { font-family: ui-monospace; }\n");
        plugin.write("site/page.js", "document.body.append('x');\n");
        trackAll(plugin.dir);
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(1);

        const err = ctx.err.join("");
        expect(err).toMatch(/✗ lint {4}\d+ findings \(\d+ files, eslint-plugin-obsidianmd 0\.5\.1, 1 without type information\):/);
        expect(err).toContain("src/main.ts:2  obsidianmd/prefer-window-timers  Use 'window.setTimeout()' instead of 'setTimeout()'");
        expect(err).toContain("site/page.js:1  obsidianmd/prefer-active-doc");
        expect(err).toContain("✗ css     3 findings (2 files):");
        expect(err).toContain("styles.css:1  css-no-important");
        expect(err).toContain("styles.css:2  css-no-has");
        expect(err).toContain("site/extra.css:1  css-browser-feature/extended-system-fonts");
        expect(err).toContain("✗ code    1 finding (1 file):");
        expect(err).toContain("src/main.ts:4  no-domain-assembly");
        expect(err).toContain("✗ meta    1 finding (manifest.json):");
        expect(err).toContain("manifest.json:1  manifest-description-no-name-prefix");
        expect(err).toMatch(/✗ scan {4}fixture-plugin: \d+ findings, each one lowers the community scorecard\./);
        expect(err).toContain("Each line reads file:line  rule  message.");
        // The order is the order the checks run in, and nothing passes silently.
        const positions = ["✗ lint", "✗ css", "✗ code", "✗ meta", "✗ scan"].map((marker) => err.indexOf(marker));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(positions.every((position) => position >= 0)).toBe(true);
        expect(ctx.out.join("")).not.toContain("✓ scan");
    });

    it("prints an advisory finding as a warning and still exits 0", async () => {
        const plugin = cleanPlugin();
        plugin.write("src/stub.ts", "// @ts-ignore\nexport const x: number = 1;\n");
        trackAll(plugin.dir);
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(0);
        expect(ctx.out.join("")).toContain("! code    src/stub.ts:1  ts-suppression");
        expect(ctx.out.join("")).toContain("✓ code    0 findings (2 files)");
        expect(ctx.err).toEqual([]);
    });

    it("skips the paths in scan.ignore in every check and says how many", async () => {
        const plugin = cleanPlugin();
        plugin.write("site/page.js", "document.body.append('x');\n");
        plugin.write("site/site.css", ".a { color: red !important; }\n");
        plugin.write("opdk.config.mjs", 'export default { scan: { ignore: ["site/**"] } };\n');
        trackAll(plugin.dir);
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(0);
        expect(ctx.out.join("")).toContain("· scan    fixture-plugin: 5 tracked files, 2 skipped by scan.ignore");
        expect(ctx.out.join("")).toContain("✓ css     0 findings (1 file)");
        expect(ctx.err).toEqual([]);
    });

    it("counts site/ without scan.ignore: ignoring it is a decision", async () => {
        const plugin = cleanPlugin();
        plugin.write("site/site.css", ".a { color: red !important; }\n");
        trackAll(plugin.dir);
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("site/site.css:1  css-no-important");
    });

    it("does not read untracked files", async () => {
        const plugin = cleanPlugin();
        trackAll(plugin.dir);
        plugin.write("src/untracked.ts", "setTimeout(() => undefined, 1);\n");
        plugin.write("extra.css", ".a { color: red !important; }\n");
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(0);
    });

    it("skips the manifest check when scan.ignore covers manifest.json", async () => {
        const plugin = cleanPlugin({ description: "Fixture plugin does things." });
        plugin.write("opdk.config.mjs", 'export default { scan: { ignore: ["manifest.json"] } };\n');
        trackAll(plugin.dir);
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(0);
    });

    it("fails outside a git repository, saying what to do, without running a check", async () => {
        const plugin = cleanPlugin();
        const ctx = createContext(plugin.dir);
        await expect(scanCommand.run([], ctx)).rejects.toThrow(/is not inside a git repository.*git init/);
        expect(ctx.out).toEqual([]);
    });

    it("fails when git tracks no file, with the hint", async () => {
        const plugin = cleanPlugin();
        initRepo(plugin.dir);
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("✗ scan    fixture-plugin: no files to scan (git tracks none in this folder).");
        expect(ctx.err.join("")).toContain("Run `git add` for the plugin's files");
        expect(ctx.out).toEqual([]);
    });

    it("fails when scan.ignore leaves nothing to scan", async () => {
        const plugin = cleanPlugin();
        plugin.write("opdk.config.mjs", 'export default { scan: { ignore: ["**"] } };\n');
        trackAll(plugin.dir);
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("no files to scan (scan.ignore skips all 5)");
        expect(ctx.err.join("")).toContain("Check scan.ignore in opdk.config.mjs.");
    });

    it("rejects arguments", async () => {
        const plugin = cleanPlugin();
        await expect(scanCommand.run(["--fix"], createContext(plugin.dir))).rejects.toThrow('"opdk scan" takes no arguments, got "--fix"');
    });

    it("fails on an invalid scan section, naming the key", async () => {
        const plugin = cleanPlugin();
        plugin.write("opdk.config.mjs", 'export default { scan: { ignore: "site/**" } };\n');
        trackAll(plugin.dir);
        await expect(scanCommand.run([], createContext(plugin.dir))).rejects.toThrow('"scan.ignore" must be an array of glob strings');
    });

    it("needs manifest.json: the plugin name comes from there", async () => {
        const plugin = createPluginFixture();
        created = plugin;
        writeFileSync(path.join(plugin.dir, "manifest.json"), "");
        await expect(scanCommand.run([], createContext(plugin.dir))).rejects.toThrow("is not valid JSON");
    });
});

describe("ESLint next to eslint-plugin-obsidianmd", () => {
    it("warns with both versions and the fix, without failing the scan, when the majors differ", async () => {
        const plugin = cleanPlugin();
        trackAll(plugin.dir);
        const ctx = createContext(plugin.dir);
        const code = await runScan({
            cwd: plugin.dir,
            manifest: { id: "fixture-plugin", name: "Fixture", version: "1.0.0", isDesktopOnly: false },
            config: {},
            reporter: ctx.reporter,
            readNestedEslintVersion: () => "1.0.0",
        });
        expect(code).toBe(0);
        const out = ctx.out.join("");
        expect(out).toContain("! lint ");
        expect(out).toContain("ESLint 1.0.0");
        expect(out).toContain('"overrides": { "eslint": "$eslint" }');
        expect(ctx.err).toEqual([]);
    });

    it("prints no warning on the install the kit runs on", async () => {
        const plugin = cleanPlugin();
        trackAll(plugin.dir);
        const ctx = createContext(plugin.dir);
        expect(await scanCommand.run([], ctx)).toBe(0);
        expect(ctx.out.join("")).not.toContain("! lint");
    });
});

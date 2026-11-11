import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBuild } from "../build/options.js";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { checkApiUsage, createApiConfig } from "./api-check.js";

// Real ESLint with type information: it misses the 5 s default when suites share the machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BUILD = resolveBuild(undefined);
const TSCONFIG_OPTIONS = { target: "ES2020", lib: ["ES2020", "DOM"], module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [] };
const TSCONFIG = JSON.stringify({ compilerOptions: TSCONFIG_OPTIONS, include: ["src/**/*.ts"] });
// Stands in for the obsidian package: the rule reads `@since` tags from node_modules/obsidian/obsidian.d.ts.
const OBSIDIAN_DTS = [
    "export class Notice {",
    "    constructor(message: string);",
    "    /** @since 0.9.7 */",
    "    old(): void;",
    "    /** @since 1.8.0 */",
    "    fresh(): void;",
    "}",
    "",
].join("\n");
const USES_FRESH = 'import { Notice } from "obsidian";\nexport const show = (): void => {\n    new Notice("x").fresh();\n};\n';

let plugin: PluginFixture | undefined;
afterEach(() => {
    plugin?.cleanup();
    plugin = undefined;
});

function pluginWithObsidian(source: string): PluginFixture {
    const created = createPluginFixture();
    plugin = created;
    created.write("tsconfig.json", TSCONFIG);
    created.write("src/main.ts", source);
    created.write("node_modules/obsidian/package.json", JSON.stringify({ name: "obsidian", version: "1.8.7", types: "obsidian.d.ts" }));
    created.write("node_modules/obsidian/obsidian.d.ts", OBSIDIAN_DTS);
    return created;
}

describe("createApiConfig", () => {
    it("enables only no-unsupported-api, with the manifest's minAppVersion as its option", () => {
        const [block] = createApiConfig("/plugin", "1.5.0");
        expect(block?.rules).toEqual({ "obsidianmd/no-unsupported-api": ["error", { minAppVersion: "1.5.0" }] });
        expect(block?.languageOptions?.parserOptions).toMatchObject({ projectService: true, tsconfigRootDir: "/plugin" });
        expect(block?.linterOptions).toEqual({ reportUnusedDisableDirectives: "off", reportUnusedInlineConfigs: "off" });
    });
});

describe("checkApiUsage", () => {
    it("fails for an API newer than minAppVersion, naming the file, line, API and versions", async () => {
        const created = pluginWithObsidian(USES_FRESH);
        const result = await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD });
        const [problem] = result.problems;
        expect(result.problems).toHaveLength(1);
        expect(problem?.severity).toBe("error");
        expect(problem?.message).toMatch(/^src\/main\.ts:3 .*fresh.* requires Obsidian v1\.8\.0, but minAppVersion is 1\.5\.0\.$/);
        expect(problem?.hint).toContain("requireApiVersion()");
    });

    it("passes when minAppVersion covers the API, and for an older API", async () => {
        const covered = pluginWithObsidian(USES_FRESH);
        const result = await checkApiUsage({ cwd: covered.dir, minAppVersion: "1.8.0", build: BUILD });
        expect(result.problems).toEqual([]);
        expect(result.passed).toBe("1 bundled source file(s) use nothing newer than minAppVersion 1.8.0");
        plugin?.cleanup();
        const old = pluginWithObsidian('import { Notice } from "obsidian";\nexport const show = (): void => {\n    new Notice("x").old();\n};\n');
        expect((await checkApiUsage({ cwd: old.dir, minAppVersion: "1.5.0", build: BUILD })).problems).toEqual([]);
    });

    it("does not report a call guarded by requireApiVersion", async () => {
        const guarded = [
            'import { Notice, requireApiVersion } from "obsidian";',
            "export const show = (): void => {",
            '    if (requireApiVersion("1.8.0")) {',
            '        new Notice("x").fresh();',
            "    }",
            "};",
            "",
        ].join("\n");
        const created = pluginWithObsidian(guarded.replace("Notice, requireApiVersion", "Notice"));
        // The stub has no requireApiVersion; declare it so the guard type-checks.
        writeFileSync(path.join(created.dir, "node_modules/obsidian/obsidian.d.ts"), `${OBSIDIAN_DTS}export function requireApiVersion(version: string): boolean;\n`);
        writeFileSync(path.join(created.dir, "src/main.ts"), guarded);
        expect((await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD })).problems).toEqual([]);
    });

    it("ignores the plugin's disable comments for other rules instead of calling them unused", async () => {
        const created = pluginWithObsidian("// eslint-disable-next-line no-useless-escape\nexport const pattern = /a/;\n");
        expect((await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD })).problems).toEqual([]);
    });

    it("fails, saying what to do, when the obsidian package is not installed", async () => {
        const created = createPluginFixture();
        plugin = created;
        created.write("src/main.ts", "export const a = 1;\n");
        const result = await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD });
        expect(result.problems[0]?.message).toBe('the "obsidian" package is not installed, so no API version can be checked.');
        expect(result.problems[0]?.hint).toContain("npm ci");
    });

    it("fails when the manifest has no minAppVersion", async () => {
        const created = createPluginFixture();
        plugin = created;
        const result = await checkApiUsage({ cwd: created.dir, minAppVersion: undefined, build: BUILD });
        expect(result.problems[0]?.message).toContain("no minAppVersion");
    });

    it("warns, not fails, when the bundle holds no TypeScript", async () => {
        const created = createPluginFixture();
        plugin = created;
        created.write("node_modules/obsidian/package.json", JSON.stringify({ name: "obsidian", version: "1.8.7" }));
        created.write("src/main.js", "module.exports = {};\n");
        const result = await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: resolveBuild({ entry: "src/main.js" }) });
        expect(result.problems.map((problem) => problem.severity)).toEqual(["warning"]);
        expect(result.problems[0]?.message).toContain("contains no TypeScript files");
    });

    it("checks the files the bundle is made of, not every file under src/", async () => {
        const created = pluginWithObsidian('import "./used";\nexport const a = 1;\n');
        created.write("src/used.ts", USES_FRESH);
        // Tracked and under src/, but nothing imports it: it never reaches main.js.
        created.write("src/unused.ts", USES_FRESH);
        // node_modules is bundled too and is never judged.
        created.write("node_modules/dep/package.json", JSON.stringify({ name: "dep", version: "1.0.0", main: "index.ts" }));
        created.write("node_modules/dep/index.ts", USES_FRESH);
        writeFileSync(path.join(created.dir, "src/main.ts"), 'import "./used";\nimport "dep";\nexport const a = 1;\n');
        const result = await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD });
        expect(result.problems.map((problem) => problem.message)).toEqual([expect.stringMatching(/^src\/used\.ts:3 /)]);
    });

    it("fails, naming the file, when a bundled file is not covered by any tsconfig", async () => {
        // The tsconfig includes src/**/*.ts and TypeScript does not follow require(), but esbuild bundles it.
        const created = pluginWithObsidian('declare const require: (id: string) => unknown;\nrequire("../lib/hidden");\nexport const a = 1;\n');
        created.write("lib/hidden.ts", USES_FRESH);
        const result = await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD });
        expect(result.problems).toHaveLength(1);
        expect(result.problems[0]?.severity).toBe("error");
        expect(result.problems[0]?.message).toBe("1 file(s) in the bundle are not covered by a tsconfig (or lie outside the plugin folder), so their Obsidian API calls were not checked: lib/hidden.ts.");
    });

    it("fails for a bundled file above the plugin folder, which cannot be linted", async () => {
        const created = pluginWithObsidian('import "../../shared-opdk-api-test";\nexport const a = 1;\n');
        const shared = path.join(created.dir, "..", "shared-opdk-api-test.ts");
        writeFileSync(shared, "export const shared = 1;\n");
        try {
            const result = await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD });
            expect(result.problems.map((problem) => problem.message).join()).toContain("../shared-opdk-api-test.ts");
            expect(result.problems[0]?.severity).toBe("error");
        } finally {
            rmSync(shared, { force: true });
        }
    });

    it("fails, saying so, when the production build does not work", async () => {
        const created = pluginWithObsidian('import "./missing";\nexport const a = 1;\n');
        const result = await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD });
        expect(result.problems).toHaveLength(1);
        expect(result.problems[0]?.message).toContain("the production build fails");
        expect(result.problems[0]?.details?.join("\n")).toContain("Could not resolve");
    });

    it("stays silent when tsconfig maps obsidian to a stub without @since tags (the documented blind spot)", async () => {
        const created = pluginWithObsidian(USES_FRESH);
        created.write("stub/obsidian.d.ts", "export class Notice { constructor(message: string); fresh(): void; }\n");
        created.write("tsconfig.json", JSON.stringify({ compilerOptions: { ...TSCONFIG_OPTIONS, baseUrl: ".", paths: { obsidian: ["stub/obsidian.d.ts"] } }, include: ["src/**/*.ts"] }));
        const result = await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD });
        expect(result.problems).toEqual([]);
    });

    it("reports a file that does not parse through the failing build, with esbuild's message", async () => {
        const created = pluginWithObsidian("export const = ;\n");
        const result = await checkApiUsage({ cwd: created.dir, minAppVersion: "1.5.0", build: BUILD });
        expect(result.problems[0]?.severity).toBe("error");
        expect(result.problems[0]?.message).toContain("the production build fails");
        expect(result.problems[0]?.details?.join("\n")).toContain("src/main.ts:1");
    });
});

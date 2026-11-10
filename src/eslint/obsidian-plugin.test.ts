import { ESLint } from "eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import * as entry from "./index.js";
import { DEFAULT_IGNORES, obsidianPlugin, resolveOptions } from "./obsidian-plugin.js";

// Real ESLint, git and esbuild runs: they miss the 5 s default when suites share the machine. Per file, so the global default stays.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe("DEFAULT_IGNORES", () => {
    it("is what all three plugins leave out, as written down from their eslint.config.js files", () => {
        expect([...DEFAULT_IGNORES].sort()).toEqual(
            [
                "node_modules/**",
                "coverage/**",
                "dist/**",
                "main.js",
                "scripts/**",
                "src/**/*.test.ts",
                "vitest.config.ts",
                "e2e/**",
                "e2e-vault.pristine/**",
                "playwright.config.ts",
                ".obsidian-unpacked/**",
                "design/**",
            ].sort(),
        );
    });

    it("leaves out paths only some plugins have, so those plugins pass them as ignores", () => {
        for (const own of ["site/**", "_site/**", ".preview/**", ".capture/**", "src/test/**", "tools/**", "integration/**", ".claude/**"]) {
            expect(DEFAULT_IGNORES).not.toContain(own);
        }
    });
});

describe("resolveOptions", () => {
    it("applies the defaults", () => {
        expect(resolveOptions({}, "/cwd")).toEqual({ rootDir: "/cwd", tsconfig: "./tsconfig.json", ignores: [...DEFAULT_IGNORES] });
    });

    it("adds ignores to the defaults instead of replacing them", () => {
        const { ignores } = resolveOptions({ ignores: ["site/**", "tools/**"] }, "/cwd");
        expect(ignores).toEqual([...DEFAULT_IGNORES, "site/**", "tools/**"]);
    });

    it("takes rootDir and tsconfig as given", () => {
        expect(resolveOptions({ rootDir: "/plugin", tsconfig: "tsconfig.lint.json" }, "/cwd")).toMatchObject({
            rootDir: "/plugin",
            tsconfig: "tsconfig.lint.json",
        });
    });

    it("rejects unknown options and lists the allowed ones", () => {
        const wrong = { ignore: [] } as unknown as Parameters<typeof resolveOptions>[0];
        expect(() => resolveOptions(wrong, "/cwd")).toThrow("unknown option(s): ignore. Allowed options: rootDir, tsconfig, ignores.");
    });

    it.each([
        [{ rootDir: "" }, '"rootDir" must be a non-empty string'],
        [{ rootDir: 5 }, '"rootDir" must be a non-empty string'],
        [{ tsconfig: "" }, '"tsconfig" must be a non-empty string'],
        [{ tsconfig: ["a"] }, '"tsconfig" must be a non-empty string'],
        [{ ignores: "site/**" }, '"ignores" must be an array of non-empty glob strings'],
        [{ ignores: [""] }, '"ignores" must be an array of non-empty glob strings'],
        [{ ignores: [3] }, '"ignores" must be an array of non-empty glob strings'],
    ])("rejects %j", (options, message) => {
        expect(() => resolveOptions(options as Parameters<typeof resolveOptions>[0], "/cwd")).toThrow(message);
    });
});

describe("obsidianPlugin", () => {
    it("is exported from the eslint entry point", () => {
        expect(entry.obsidianPlugin).toBe(obsidianPlugin);
        expect(entry.DEFAULT_IGNORES).toBe(DEFAULT_IGNORES);
    });

    it("starts with eslint-plugin-obsidianmd's recommended preset", () => {
        const config = obsidianPlugin({ rootDir: "/plugin" });
        expect(config.slice(0, obsidianmd.configs.recommended.length)).toEqual(obsidianmd.configs.recommended);
    });

    it("types the TypeScript files from the plugin's tsconfig", () => {
        const block = obsidianPlugin({ rootDir: "/plugin", tsconfig: "./tsconfig.json" }).find((entry) => entry.files?.includes("**/*.ts") === true);
        expect(block?.languageOptions?.parserOptions).toEqual({ project: "./tsconfig.json", tsconfigRootDir: "/plugin" });
    });

    it("defaults rootDir to the folder ESLint runs in", () => {
        const block = obsidianPlugin().find((entry) => entry.files?.includes("**/*.ts") === true);
        expect(block?.languageOptions?.parserOptions).toMatchObject({ tsconfigRootDir: process.cwd() });
    });

    it("makes the three shared rules errors", () => {
        const rules = obsidianPlugin({ rootDir: "/plugin" }).find((entry) => entry.files?.includes("**/*.ts") === true)?.rules;
        expect(rules?.["obsidianmd/prefer-window-timers"]).toBe("error");
        expect(rules?.["obsidianmd/settings-tab/prefer-setting-definitions"]).toBe("error");
        expect(rules?.["@typescript-eslint/no-unused-vars"]).toEqual([
            "error",
            { args: "all", argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" },
        ]);
    });

    it("leaves @typescript-eslint/no-misused-promises to the preset's obsidianmd replacement", () => {
        const own = obsidianPlugin({ rootDir: "/plugin" }).find((entry) => entry.files?.includes("**/*.ts") === true)?.rules;
        expect(own?.["@typescript-eslint/no-misused-promises"]).toBeUndefined();
    });

    it("ends with the ignores, the defaults and the plugin's own", () => {
        expect(obsidianPlugin({ rootDir: "/plugin", ignores: ["site/**"] }).at(-1)).toEqual({ ignores: [...DEFAULT_IGNORES, "site/**"] });
    });

    it("throws for a bad option when the config is built", () => {
        expect(() => obsidianPlugin({ ignores: "x" as unknown as string[] })).toThrow('"ignores" must be an array');
    });
});

describe("obsidianPlugin on a real project", () => {
    let plugin: PluginFixture;
    beforeEach(() => {
        plugin = createPluginFixture();
        plugin.write(
            "tsconfig.json",
            JSON.stringify({
                compilerOptions: { target: "ES2020", lib: ["ES2020", "DOM"], module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [] },
                include: ["src/**/*.ts"],
            }),
        );
    });
    afterEach(() => {
        plugin.cleanup();
    });

    async function lint(files: string[], options: Parameters<typeof obsidianPlugin>[0] = {}): Promise<string[]> {
        const eslint = new ESLint({
            cwd: plugin.dir,
            overrideConfigFile: true,
            baseConfig: obsidianPlugin({ rootDir: plugin.dir, ...options }),
            warnIgnored: false,
        });
        const results = await eslint.lintFiles(files);
        return results.flatMap((result) =>
            result.messages.map((message) => `${result.filePath.slice(plugin.dir.length + 1)}:${String(message.line)} ${message.ruleId ?? "parse-error"} ${message.severity === 2 ? "error" : "warn"}`),
        );
    }

    it("reports a timer without window as an error, which the preset alone only warns about", async () => {
        plugin.write("src/main.ts", "export const wait = (): void => {\n    setTimeout(() => undefined, 1);\n};\n");
        expect(await lint(["src/main.ts"])).toEqual(["src/main.ts:2 obsidianmd/prefer-window-timers error"]);
    });

    it("reports an unused argument unless it starts with an underscore", async () => {
        plugin.write("src/main.ts", "export const f = (used: number, unused: number, _skipped: number): number => used;\n");
        expect(await lint(["src/main.ts"])).toEqual(["src/main.ts:1 @typescript-eslint/no-unused-vars error"]);
    });

    it("passes clean code", async () => {
        plugin.write("src/main.ts", "export const greet = (name: string): string => `hello ${name}`;\n");
        expect(await lint(["src/main.ts"])).toEqual([]);
    });

    it("skips the default ignores and the plugin's own", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("src/main.test.ts", "setTimeout(() => undefined, 1);\n");
        plugin.write("site/page.js", "setTimeout(() => undefined, 1);\n");
        expect(await lint(["src/main.test.ts"])).toEqual([]);
        expect(await lint(["site/page.js"], { ignores: ["site/**"] })).toEqual([]);
        expect(await lint(["site/page.js"])).toEqual(["site/page.js:1 obsidianmd/prefer-window-timers warn"]);
    });
});

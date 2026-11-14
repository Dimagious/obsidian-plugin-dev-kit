import { ESLint } from "eslint";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { DEFAULT_PROJECT_CLASH_MESSAGE, hideKitImports, isDefaultProjectClash, KIT_IMPORT_FILE_HINT, KIT_IMPORT_HINT, kitImportHint, runScannerLint, summariseOutsideProject, toFindings } from "./lint.js";
import { isOutsideProject, NO_INPUTS_MESSAGE, PROJECT_SERVICE_MESSAGE } from "./outside-project.js";
import { createScannerConfig } from "./scanner-config.js";

// Real ESLint, git and esbuild runs: they miss the 5 s default when suites share the machine. Per file, so the global default stays.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const TSCONFIG = JSON.stringify({
    compilerOptions: { target: "ES2020", lib: ["ES2020", "DOM"], module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [] },
    include: ["src/**/*.ts"],
});

let plugin: PluginFixture;
beforeEach(() => {
    plugin = createPluginFixture();
    plugin.write("tsconfig.json", TSCONFIG);
});
afterEach(() => {
    plugin.cleanup();
});

/** A package that exists and resolves, standing in for the kit as the plugin installed it. */
function writeKitStub(): void {
    plugin.write("node_modules/obsidian-plugin-dev-kit/package.json", JSON.stringify({ name: "obsidian-plugin-dev-kit", version: "1.0.0", type: "module", exports: { "./eslint": { types: "./eslint.d.ts", default: "./eslint.js" } } }));
    plugin.write("node_modules/obsidian-plugin-dev-kit/eslint.d.ts", "export declare function obsidianPlugin(options: { rootDir: string }): object[];\n");
    plugin.write("node_modules/obsidian-plugin-dev-kit/eslint.js", "export const obsidianPlugin = () => [];\n");
}
const KIT_CONFIG = ['import { obsidianPlugin } from "obsidian-plugin-dev-kit/eslint";', "export default [...obsidianPlugin({ rootDir: '.' })];", ""].join("\n");

describe("runScannerLint", () => {
    it("reports nothing for clean code", async () => {
        plugin.write("src/main.ts", "export const greet = (name: string): string => `hello ${name}`;\n");
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "manifest.json"]);
        expect(outcome.findings).toEqual([]);
        expect(outcome.untyped).toBe(0);
        expect(outcome.linted).toBe(2);
    });

    it("reports warnings as well as errors, with the line and the rule", async () => {
        plugin.write(
            "src/main.ts",
            [
                "export const a = (el: HTMLElement): void => {",
                '    el.addClass("x");',
                "    document.body.classList.add(\"x\"); // warning in the preset",
                "    setTimeout(() => undefined, 1);",
                '    new Function("return 1");', // an error: the scanner keeps this one at error
                "};",
                "",
            ].join("\n"),
        );
        const { findings } = await runScannerLint(plugin.dir, ["src/main.ts"]);
        const byRule = new Map(findings.map((finding) => [finding.rule, finding]));
        expect(byRule.get("obsidianmd/prefer-active-doc")).toMatchObject({ check: "lint", file: "src/main.ts", line: 3 });
        expect(byRule.get("obsidianmd/prefer-window-timers")).toMatchObject({ file: "src/main.ts", line: 4 });
        expect([...byRule.keys()].some((rule) => rule.includes("new-func") || rule.includes("rule-custom-message"))).toBe(true);
    });

    it("lints a file no tsconfig covers without type information, and reports it only as an advisory line", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("site/page.js", "document.body.append('x');\nsetTimeout(function () {}, 1);\n");
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "site/page.js"]);
        expect(outcome.untyped).toBe(1);
        expect(outcome.linted).toBe(2);
        expect(outcome.findings).toEqual([
            {
                check: "lint",
                file: "site/page.js",
                line: 1,
                rule: "outside-tsconfig",
                message: expect.stringContaining("2 lint findings in a file no tsconfig covers (first: obsidianmd/prefer-active-doc)") as string,
                advisory: true,
            },
        ]);
        expect(outcome.findings.some((finding) => finding.message.includes(PROJECT_SERVICE_MESSAGE))).toBe(false);
    });

    it("keeps no-implied-eval on for a TypeScript file linted without type information", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("site/page.ts", 'setTimeout("alert(1)", 1);\n');
        const outcome = await runScannerLint(plugin.dir, ["site/page.ts"]);
        expect(outcome.untyped, JSON.stringify(outcome)).toBe(1);
        expect(outcome.findings).toHaveLength(1);
        expect(outcome.findings[0]).toMatchObject({ file: "site/page.ts", rule: "outside-tsconfig", advisory: true });
        expect(outcome.findings[0]?.message).toContain("(first: no-implied-eval)");
    });

    it("lints every file without type information when the plugin has no tsconfig at all", async () => {
        plugin.cleanup();
        plugin = createPluginFixture();
        plugin.write("main.js", "document.body.append('x');\n");
        plugin.write("src/view.js", "document.body.append('x');\n");
        const outcome = await runScannerLint(plugin.dir, ["src/view.js"]);
        expect(outcome.untyped).toBe(1);
        expect(outcome.linted).toBe(1);
        expect(outcome.findings).toMatchObject([{ file: "src/view.js", rule: "outside-tsconfig", advisory: true }]);
        expect(outcome.findings[0]?.message).toContain("(first: obsidianmd/prefer-active-doc)");
    });

    it("leaves out what the scanner ignores (tests, scripts, build output) and files that are not code", async () => {
        const offending = "document.body.append('x');\n";
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("src/main.test.ts", offending);
        plugin.write("scripts/tool.js", offending);
        plugin.write("main.js", offending);
        plugin.write("README.md", offending);
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "src/main.test.ts", "scripts/tool.js", "main.js", "README.md"]);
        expect(outcome.findings).toEqual([]);
        expect(outcome.linted).toBe(1);
    });

    it("lints a file without type information when the tsconfig's include matches nothing (TS18003 on Linux)", async () => {
        plugin.write("site/page.ts", "document.body.append('x');\n");
        const outcome = await runScannerLint(plugin.dir, ["site/page.ts"]);
        expect(outcome.untyped, JSON.stringify(outcome)).toBe(1);
        expect(outcome.findings.some((finding) => finding.rule === "parse-error"), JSON.stringify(outcome)).toBe(false);
        expect(outcome.findings).toMatchObject([{ file: "site/page.ts", rule: "outside-tsconfig", advisory: true }]);
        expect(outcome.findings[0]?.message).toContain("(first: obsidianmd/prefer-active-doc)");
    });

    it("lints eslint.config.ts with types when the tsconfig has no include and so covers it already", async () => {
        plugin.write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2020", lib: ["ES2020", "DOM"], module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [] } }));
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("eslint.config.ts", "const parsed = JSON.parse('1');\nexport default [parsed];\n");
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "eslint.config.ts"]);
        expect(outcome.findings.some((finding) => finding.rule === "parse-error"), JSON.stringify(outcome.findings)).toBe(false);
        expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`)).toContain(
            "eslint.config.ts:1 @typescript-eslint/no-unsafe-assignment",
        );
        expect(outcome.untyped).toBe(0);
    });

    it("lints eslint.config.js with types when an allowJs tsconfig includes it", async () => {
        plugin.write(
            "tsconfig.json",
            JSON.stringify({ compilerOptions: { target: "ES2020", lib: ["ES2020", "DOM"], module: "ESNext", moduleResolution: "Bundler", allowJs: true, noEmit: true, types: [] }, include: ["**/*.js"] }),
        );
        plugin.write("eslint.config.js", "const parsed = JSON.parse('1');\nexport default [parsed];\n");
        const outcome = await runScannerLint(plugin.dir, ["eslint.config.js"]);
        expect(outcome.findings.some((finding) => finding.rule === "parse-error"), JSON.stringify(outcome.findings)).toBe(false);
        expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`)).toContain(
            "eslint.config.js:1 @typescript-eslint/no-unsafe-assignment",
        );
    });

    it("still lints eslint.config.js as a default project when no tsconfig covers it", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("eslint.config.js", "const parsed = JSON.parse('1');\nexport default [parsed];\n");
        const outcome = await runScannerLint(plugin.dir, ["eslint.config.js"]);
        expect(outcome.findings.some((finding) => finding.rule === "parse-error"), JSON.stringify(outcome.findings)).toBe(false);
        expect(outcome.untyped).toBe(0);
        expect(outcome.findings.map((finding) => finding.rule)).toContain("@typescript-eslint/no-unsafe-assignment");
    });

    it("reports Node built-ins in a setup file: the scanner's ignore list does not name it, the preset's exemption does", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("src/global-setup.ts", 'import "node:fs";\nexport const a = 1;\n');
        plugin.write("src/test-setup.ts", 'import "node:path";\nexport const b = 1;\n');
        plugin.write("src/db.global-setup.ts", 'import "node:os";\nexport const c = 1;\n');
        plugin.write("src/setupTests.ts", 'import "node:url";\nexport const d = 1;\n');
        plugin.write("src/app.setup.ts", 'import "node:util";\nexport const e = 1;\n');
        const files = ["src/main.ts", "src/global-setup.ts", "src/test-setup.ts", "src/db.global-setup.ts", "src/setupTests.ts", "src/app.setup.ts"];
        const outcome = await runScannerLint(plugin.dir, files);
        expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`).sort()).toEqual([
            "src/app.setup.ts:1 obsidianmd/no-nodejs-modules",
            "src/db.global-setup.ts:1 obsidianmd/no-nodejs-modules",
            "src/global-setup.ts:1 obsidianmd/no-nodejs-modules",
            "src/setupTests.ts:1 obsidianmd/no-nodejs-modules",
            "src/test-setup.ts:1 obsidianmd/no-nodejs-modules",
        ]);
        expect(outcome.findings.find((finding) => finding.file === "src/global-setup.ts")?.message).toContain('Do not import Node.js built-in module "node:fs"');
    });

    it("keeps the other files the preset exempts exempt: a worker runs in a Worker, where a window timer is wrong advice", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("src/parse.worker.ts", 'import "node:fs";\nsetTimeout(() => undefined, 1);\nexport const t = globalThis;\n');
        plugin.write("src/workers/index.ts", "setTimeout(() => undefined, 1);\nexport const t = globalThis;\n");
        plugin.write("src/test-utils/helpers.ts", 'import "node:fs";\nexport const a = 1;\n');
        plugin.write("src/thing.testing.ts", 'import "node:fs";\nexport const a = 1;\n');
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "src/parse.worker.ts", "src/workers/index.ts", "src/test-utils/helpers.ts", "src/thing.testing.ts"]);
        const runtimeRules = outcome.findings.filter((finding) => /prefer-window-timers|no-global-this|prefer-active-doc|platform$/.test(finding.rule));
        expect(runtimeRules, JSON.stringify(outcome.findings)).toEqual([]);
        // A worker is still read by the scanner: the rules the preset applies to it (here the Node-module rule) stay.
        expect(outcome.findings.some((finding) => finding.file === "src/parse.worker.ts" && finding.rule === "obsidianmd/no-nodejs-modules")).toBe(true);
    });

    // Garmy 1.1.1 added e2e/tsconfig.json and its scorecard lists the runtime rules and the no-unsafe-* warnings for
    // e2e/*.ts, spec files excepted. Version 1.1.0, with no e2e tsconfig, listed nothing from e2e/.
    describe("the e2e folder", () => {
        const HELPER = ['import "node:child_process";', "export const wait = (): void => {", "    setTimeout(() => undefined, 1);", "};", "export const g = globalThis;", ""].join("\n");
        const EVAL = 'export const e = eval("1");\n';
        const E2E_TSCONFIG = JSON.stringify({ extends: "../tsconfig.json", include: ["./**/*.ts"] });

        it("is linted when a tsconfig.json covers it, with the runtime rules the preset exempts it from", async () => {
            plugin.write("src/main.ts", "export const a = 1;\n");
            plugin.write("e2e/tsconfig.json", E2E_TSCONFIG);
            plugin.write("e2e/helpers.ts", HELPER);
            plugin.write("e2e/deep/more.ts", HELPER);
            const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "e2e/helpers.ts", "e2e/deep/more.ts"]);
            expect(outcome.untyped).toBe(0);
            expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`).sort()).toEqual([
                "e2e/deep/more.ts:1 obsidianmd/no-nodejs-modules",
                "e2e/deep/more.ts:3 obsidianmd/prefer-window-timers",
                "e2e/deep/more.ts:5 obsidianmd/no-global-this",
                "e2e/helpers.ts:1 obsidianmd/no-nodejs-modules",
                "e2e/helpers.ts:3 obsidianmd/prefer-window-timers",
                "e2e/helpers.ts:5 obsidianmd/no-global-this",
            ]);
        });

        it("does not report prefer-active-doc there, as the scorecard has none for a `document` in an evaluate callback, but still does in src", async () => {
            const read = "export const root = (sel: string): Element | null => document.querySelector(sel);\n";
            plugin.write("src/main.ts", read);
            plugin.write("e2e/tsconfig.json", E2E_TSCONFIG);
            plugin.write("e2e/helpers.ts", read);
            const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "e2e/helpers.ts"]);
            expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`)).toEqual(["src/main.ts:1 obsidianmd/prefer-active-doc"]);
        });

        it("reports the type-aware warnings too: an untyped value flowing out of a helper", async () => {
            plugin.write("src/main.ts", "export const a = 1;\n");
            plugin.write("e2e/tsconfig.json", E2E_TSCONFIG);
            plugin.write("e2e/helpers.ts", "export const read = (value: unknown): string => (value as any).name;\n");
            const outcome = await runScannerLint(plugin.dir, ["e2e/helpers.ts"]);
            expect(outcome.findings.map((finding) => finding.rule)).toContain("@typescript-eslint/no-unsafe-return");
        });

        it("leaves out spec files in it, which the scanner's list names, and the e2e-tests folder and *.e2e.* files, which no scorecard shows", async () => {
            plugin.write("src/main.ts", "export const a = 1;\n");
            // `no-eval` is not one of the exempted runtime rules, so only the ignore list can keep these quiet.
            plugin.write("e2e/tsconfig.json", JSON.stringify({ extends: "../tsconfig.json", include: ["./**/*.ts", "../e2e-tests/**/*.ts", "../src/**/*.ts"] }));
            plugin.write("e2e/helpers.spec.ts", EVAL);
            plugin.write("e2e-tests/helpers.ts", EVAL);
            plugin.write("src/flow.e2e.ts", EVAL);
            const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "e2e/helpers.spec.ts", "e2e-tests/helpers.ts", "src/flow.e2e.ts"]);
            expect(outcome.findings).toEqual([]);
        });

        it("is not reported when no tsconfig.json covers it: a root tsconfig.e2e.json does not count, the file prints as outside every project", async () => {
            plugin.write("src/main.ts", "export const a = 1;\n");
            plugin.write("tsconfig.e2e.json", JSON.stringify({ extends: "./tsconfig.json", include: ["e2e/**/*.ts"] }));
            plugin.write("e2e/helpers.ts", "export const read = (value: unknown): string => (value as any).name;\n");
            const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "e2e/helpers.ts"]);
            expect(outcome.untyped).toBe(1);
            // Only the advisory pass saw it: the typed warnings are absent, as on the scorecard.
            expect(outcome.findings.some((finding) => finding.file === "e2e/helpers.ts" && finding.rule.includes("no-unsafe"))).toBe(false);
        });
    });

    it("still leaves out the files the scanner's own ignore list names", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("src/main.test.ts", 'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n');
        plugin.write("scripts/build.js", 'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n');
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "src/main.test.ts", "scripts/build.js"]);
        expect(outcome.findings).toEqual([]);
    });

    it("lints a script that imports the kit as the scanner sees it, where the kit has no dist (no-unsafe-call and no-unsafe-assignment)", async () => {
        writeKitStub();
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("eslint.config.js", KIT_CONFIG);
        const outcome = await runScannerLint(plugin.dir, ["eslint.config.js"]);
        expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`).sort()).toEqual([
            "eslint.config.js:2 @typescript-eslint/no-unsafe-assignment",
            "eslint.config.js:2 @typescript-eslint/no-unsafe-call",
        ]);
    });

    it("tells the plugin to rename a config that imports the kit to .mjs, on the two findings only", async () => {
        writeKitStub();
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("eslint.config.js", KIT_CONFIG);
        const { findings } = await runScannerLint(plugin.dir, ["eslint.config.js"]);
        expect(findings).toHaveLength(2);
        for (const finding of findings) {
            expect(finding.message).toContain(KIT_IMPORT_HINT);
        }
        expect(KIT_IMPORT_HINT).toContain("eslint.config.mjs");
    });

    it("does not tell an e2e file covered by a tsconfig to use .mjs: the hint says to keep it out of every tsconfig", async () => {
        writeKitStub();
        plugin.write("tsconfig.json", TSCONFIG);
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("e2e/tsconfig.json", JSON.stringify({ extends: "../tsconfig.json", include: ["./**/*.ts"] }));
        plugin.write("e2e/fixtures.ts", 'import { obsidianPlugin } from "obsidian-plugin-dev-kit/e2e";\nexport const config = obsidianPlugin({ rootDir: "." });\n');
        const { findings } = await runScannerLint(plugin.dir, ["e2e/fixtures.ts"]);
        const hinted = findings.filter((finding) => finding.message.includes("installs the kit without building it"));
        expect(hinted.length).toBeGreaterThan(0);
        for (const finding of hinted) {
            expect(finding.message).toContain(KIT_IMPORT_FILE_HINT);
            expect(finding.message).not.toContain(".mjs");
        }
    });

    it("picks the .mjs hint for eslint.config.* in any folder depth and the tsconfig hint for the rest", () => {
        expect(kitImportHint("/p/eslint.config.js")).toBe(KIT_IMPORT_HINT);
        expect(kitImportHint("eslint.config.ts")).toBe(KIT_IMPORT_HINT);
        expect(kitImportHint("/p/e2e/fixtures.ts")).toBe(KIT_IMPORT_FILE_HINT);
        expect(kitImportHint("/p/my-eslint.config.js.ts")).toBe(KIT_IMPORT_FILE_HINT);
    });

    it("does not scan an eslint.config.mjs that imports the kit: the scanner ignores .mjs, so nothing is unresolved there", async () => {
        writeKitStub();
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("eslint.config.mjs", KIT_CONFIG);
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "eslint.config.mjs"]);
        expect(outcome.findings).toEqual([]);
        expect(outcome.linted).toBe(1);
    });

    it("hides the kit import in an eslint.config.ts a tsconfig covers, which is linted again with types after the default-project clash", async () => {
        writeKitStub();
        plugin.write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2020", lib: ["ES2020", "DOM"], module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, types: [] } }));
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("eslint.config.ts", KIT_CONFIG);
        const outcome = await runScannerLint(plugin.dir, ["eslint.config.ts"]);
        expect(outcome.findings.some((finding) => finding.rule === "parse-error"), JSON.stringify(outcome.findings)).toBe(false);
        expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`).sort()).toEqual([
            "eslint.config.ts:2 @typescript-eslint/no-unsafe-assignment",
            "eslint.config.ts:2 @typescript-eslint/no-unsafe-call",
        ]);
        expect(outcome.untyped).toBe(0);
    });

    it("lints a script that does not import the kit as it is", async () => {
        plugin.write("package.json", JSON.stringify({ name: "fixture", version: "1.0.0", devDependencies: { "some-config": "1.0.0" } }));
        plugin.write("node_modules/some-config/package.json", JSON.stringify({ name: "some-config", version: "1.0.0", type: "module", exports: { ".": { types: "./index.d.ts", default: "./index.js" } } }));
        plugin.write("node_modules/some-config/index.d.ts", "export declare function preset(): object[];\n");
        plugin.write("node_modules/some-config/index.js", "export const preset = () => [];\n");
        plugin.write("eslint.config.js", ['import { preset } from "some-config";', "export default [...preset()];", ""].join("\n"));
        const outcome = await runScannerLint(plugin.dir, ["eslint.config.js"]);
        expect(outcome.findings).toEqual([]);
    });

    it("pins typescript-eslint's wording for a default project that a tsconfig also covers", async () => {
        plugin.write("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "Bundler", noEmit: true, types: [] } }));
        plugin.write("eslint.config.ts", "export default [];\n");
        const eslint = new ESLint({
            cwd: plugin.dir,
            overrideConfigFile: true,
            baseConfig: createScannerConfig({ cwd: plugin.dir, typeAware: true }),
        });
        const [result] = await eslint.lintFiles(["eslint.config.ts"]);
        expect(result !== undefined && isDefaultProjectClash(result), JSON.stringify(result?.messages)).toBe(true);
    });

    it("pins typescript-eslint's wording for a file outside the project", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("site/page.js", "export const a = 1;\n");
        const eslint = new ESLint({
            cwd: plugin.dir,
            overrideConfigFile: true,
            baseConfig: createScannerConfig({ cwd: plugin.dir, typeAware: true }),
        });
        const [result] = await eslint.lintFiles(["site/page.js"]);
        expect(
            result?.messages.some((message) => message.message.includes(PROJECT_SERVICE_MESSAGE)),
            JSON.stringify(result?.messages),
        ).toBe(true);
    });
});

describe("isDefaultProjectClash", () => {
    const resultWith = (message: string): ESLint.LintResult => ({ filePath: "/p/eslint.config.ts", messages: [{ ruleId: null, message }] }) as ESLint.LintResult;

    it("recognises the clash and leaves other messages alone", () => {
        expect(isDefaultProjectClash(resultWith(`Parsing error: /p/eslint.config.ts ${DEFAULT_PROJECT_CLASH_MESSAGE}.`))).toBe(true);
        expect(isDefaultProjectClash(resultWith("Parsing error: ';' expected."))).toBe(false);
    });
});

describe("toFindings", () => {
    it("gives a message without a line the line 0, which prints without a position", () => {
        const result = { filePath: "/p/a.ts", messages: [{ ruleId: null, message: "Parsing error: boom" }] } as ESLint.LintResult;
        const [finding] = toFindings([result], "/p");
        expect(finding).toMatchObject({ file: "a.ts", line: 0, rule: "parse-error" });
    });
});

describe("isOutsideProject", () => {
    const resultWith = (message: string): ESLint.LintResult => ({ filePath: "/p/site/page.ts", messages: [{ ruleId: null, line: 1, message }] }) as ESLint.LintResult;

    it("recognises both ways typescript-eslint says a file is in no project", () => {
        expect(isOutsideProject(resultWith(`Parsing error: /p/site/page.ts ${PROJECT_SERVICE_MESSAGE}. Consider ...`))).toBe(true);
        // GitHub Actions (Linux x64) reports TS18003 for a file next to a tsconfig whose include matches nothing.
        expect(isOutsideProject(resultWith(`Parsing error: Unable to parse the specified 'tsconfig' file.\n\nerror TS18003: ${NO_INPUTS_MESSAGE} '/p/tsconfig.json'.`))).toBe(true);
    });

    it("leaves other parse errors alone", () => {
        expect(isOutsideProject(resultWith("Parsing error: ';' expected."))).toBe(false);
        expect(isOutsideProject({ filePath: "/p/a.ts", messages: [] } as unknown as ESLint.LintResult)).toBe(false);
    });
});

describe("toFindings", () => {
    it("maps every message, naming a parse error", () => {
        const result = {
            filePath: `${plugin.dir}/src/a.ts`,
            messages: [
                { ruleId: "no-alert", line: 4, message: "Unexpected alert." },
                { ruleId: null, line: 1, message: "Parsing error: x" },
            ],
        } as ESLint.LintResult;
        expect(toFindings([result], plugin.dir)).toEqual([
            { check: "lint", file: "src/a.ts", line: 4, rule: "no-alert", message: "Unexpected alert." },
            { check: "lint", file: "src/a.ts", line: 1, rule: "parse-error", message: "Parsing error: x" },
        ]);
    });
});

describe("hideKitImports", () => {
    const hidden = (text: string): string => hideKitImports(text);

    it.each([
        ['import { a } from "obsidian-plugin-dev-kit";', 'import { a } from "obsidian-plugin-dev-kit-not-built";'],
        ["import { a } from 'obsidian-plugin-dev-kit/eslint';", "import { a } from 'obsidian-plugin-dev-kit-not-built/eslint';"],
        ['import "obsidian-plugin-dev-kit/e2e";', 'import "obsidian-plugin-dev-kit-not-built/e2e";'],
        ['const m = await import("obsidian-plugin-dev-kit/vitest");', 'const m = await import("obsidian-plugin-dev-kit-not-built/vitest");'],
        ['const m = require("obsidian-plugin-dev-kit");', 'const m = require("obsidian-plugin-dev-kit-not-built");'],
        ['export { x } from "obsidian-plugin-dev-kit/eslint";', 'export { x } from "obsidian-plugin-dev-kit-not-built/eslint";'],
    ])("points %s at a package that does not exist", (input, expected) => {
        expect(hidden(input)).toBe(expected);
    });

    it("keeps the text on its lines, so findings keep their line numbers", () => {
        const input = 'import {\n  a,\n} from "obsidian-plugin-dev-kit/eslint";\nexport default a();\n';
        expect(hidden(input).split("\n")).toHaveLength(input.split("\n").length);
    });

    it.each(['const s = "obsidian-plugin-dev-kit";', 'import { a } from "obsidian-plugin-dev-kit-other";', 'import { a } from "my-obsidian-plugin-dev-kit";', "// from obsidian-plugin-dev-kit/eslint"])(
        "leaves %s alone",
        (input) => {
            expect(hidden(input)).toBe(input);
        },
    );
});

describe("summariseOutsideProject", () => {
    it("makes one advisory finding per file, with the count and the first rule", () => {
        const result = {
            filePath: "/p/site/a.js",
            messages: [
                { ruleId: "no-alert", line: 7, message: "x" },
                { ruleId: "no-eval", line: 9, message: "y" },
            ],
        } as ESLint.LintResult;
        const other = { filePath: "/p/site/b.js", messages: [{ ruleId: null, line: 1, message: "Parsing error: z" }] } as ESLint.LintResult;
        const clean = { filePath: "/p/site/c.js", messages: [] } as unknown as ESLint.LintResult;
        const findings = summariseOutsideProject([result, other, clean], "/p");
        expect(findings).toHaveLength(2);
        expect(findings[0]).toMatchObject({ check: "lint", file: "site/a.js", line: 7, rule: "outside-tsconfig", advisory: true });
        expect(findings[0]?.message).toContain("2 lint findings in a file no tsconfig covers (first: no-alert)");
        expect(findings[1]?.message).toContain("1 lint finding in a file no tsconfig covers (first: parse-error)");
    });

    it("says nothing about files without findings", () => {
        expect(summariseOutsideProject([], "/p")).toEqual([]);
    });
});

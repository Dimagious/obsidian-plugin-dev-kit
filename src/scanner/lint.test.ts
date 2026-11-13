import { ESLint } from "eslint";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { DEFAULT_PROJECT_CLASH_MESSAGE, hideKitImports, isDefaultProjectClash, isOutsideProject, NO_INPUTS_MESSAGE, PROJECT_SERVICE_MESSAGE, runScannerLint, summariseOutsideProject, toFindings } from "./lint.js";
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

    it("reports Node built-ins in a global-setup file: the scanner's ignore list does not name it, the preset's exemption does", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("src/global-setup.ts", 'import "node:fs";\nexport const a = 1;\n');
        plugin.write("src/test-setup.ts", 'import "node:path";\nexport const b = 1;\n');
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "src/global-setup.ts", "src/test-setup.ts"]);
        expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`)).toEqual([
            "src/global-setup.ts:1 obsidianmd/no-nodejs-modules",
            "src/test-setup.ts:1 obsidianmd/no-nodejs-modules",
        ]);
        expect(outcome.findings[0]?.message).toContain('Do not import Node.js built-in module "node:fs"');
    });

    it("still leaves out the files the scanner's own ignore list names", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("src/main.test.ts", 'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n');
        plugin.write("scripts/build.js", 'import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n');
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "src/main.test.ts", "scripts/build.js"]);
        expect(outcome.findings).toEqual([]);
    });

    it("lints a script that imports the kit as the scanner sees it, where the kit has no dist (no-unsafe-call and no-unsafe-assignment)", async () => {
        // A package that exists and resolves, standing in for the kit as the plugin installed it.
        plugin.write("node_modules/obsidian-plugin-dev-kit/package.json", JSON.stringify({ name: "obsidian-plugin-dev-kit", version: "1.0.0", type: "module", exports: { "./eslint": { types: "./eslint.d.ts", default: "./eslint.js" } } }));
        plugin.write("node_modules/obsidian-plugin-dev-kit/eslint.d.ts", "export declare function obsidianPlugin(options: { rootDir: string }): object[];\n");
        plugin.write("node_modules/obsidian-plugin-dev-kit/eslint.js", "export const obsidianPlugin = () => [];\n");
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("eslint.config.js", ['import { obsidianPlugin } from "obsidian-plugin-dev-kit/eslint";', "export default [...obsidianPlugin({ rootDir: '.' })];", ""].join("\n"));
        const outcome = await runScannerLint(plugin.dir, ["eslint.config.js"]);
        expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`).sort()).toEqual([
            "eslint.config.js:2 @typescript-eslint/no-unsafe-assignment",
            "eslint.config.js:2 @typescript-eslint/no-unsafe-call",
        ]);
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

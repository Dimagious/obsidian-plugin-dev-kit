import { ESLint } from "eslint";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { PROJECT_SERVICE_MESSAGE, runScannerLint, toFindings } from "./lint.js";
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

    it("lints a file no tsconfig covers without type information instead of failing to parse it", async () => {
        plugin.write("src/main.ts", "export const a = 1;\n");
        plugin.write("site/page.js", "document.body.append('x');\nsetTimeout(function () {}, 1);\n");
        const outcome = await runScannerLint(plugin.dir, ["src/main.ts", "site/page.js"]);
        expect(outcome.untyped).toBe(1);
        expect(outcome.linted).toBe(2);
        const rules = outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`);
        expect(rules).toContain("site/page.js:1 obsidianmd/prefer-active-doc");
        expect(rules).toContain("site/page.js:2 obsidianmd/prefer-window-timers");
        expect(outcome.findings.some((finding) => finding.message.includes(PROJECT_SERVICE_MESSAGE))).toBe(false);
        expect(outcome.findings.some((finding) => finding.rule === "parse-error")).toBe(false);
    });

    it("keeps no-implied-eval on for a TypeScript file linted without type information", async () => {
        plugin.write("site/page.ts", 'setTimeout("alert(1)", 1);\n');
        const outcome = await runScannerLint(plugin.dir, ["site/page.ts"]);
        expect(outcome.untyped, JSON.stringify(outcome)).toBe(1);
        const rules = outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`);
        expect(rules).toContain("site/page.ts:1 no-implied-eval");
    });

    it("lints every file without type information when the plugin has no tsconfig at all", async () => {
        plugin.cleanup();
        plugin = createPluginFixture();
        plugin.write("main.js", "document.body.append('x');\n");
        plugin.write("src/view.js", "document.body.append('x');\n");
        const outcome = await runScannerLint(plugin.dir, ["src/view.js"]);
        expect(outcome.untyped).toBe(1);
        expect(outcome.linted).toBe(1);
        expect(outcome.findings.map((finding) => `${finding.file}:${String(finding.line)} ${finding.rule}`)).toContain(
            "src/view.js:1 obsidianmd/prefer-active-doc",
        );
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

    it("pins typescript-eslint's wording for a file outside the project", async () => {
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

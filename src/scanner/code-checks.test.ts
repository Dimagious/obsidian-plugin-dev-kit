import { describe, expect, it } from "vitest";
import {
    checkCode,
    checkDomainAssembly,
    checkTsSuppressions,
    isShippedSource,
    stripComments,
    type SourceFile,
} from "./code-checks.js";

const file = (text: string, filePath = "src/a.ts"): SourceFile => ({ path: filePath, text });

describe("stripComments", () => {
    it("blanks a line comment and keeps the code before it", () => {
        expect(stripComments("const a = 1; // the document.\n")).toBe(`const a = 1; ${" ".repeat("// the document.".length)}\n`);
    });

    it("blanks a JSDoc block whose inner lines carry no comment marker", () => {
        const text = "/**\n * The user leaves the document.\n * Second line.\n */\nconst x = 1;\n";
        const stripped = stripComments(text);
        expect(stripped).not.toContain("document");
        expect(stripped.split("\n")).toHaveLength(text.split("\n").length);
        expect(stripped.endsWith("const x = 1;\n")).toBe(true);
    });

    it("keeps the length and every newline, so line numbers still match", () => {
        const text = "a /* x\ny */ b // c\n/* d */\n";
        const stripped = stripComments(text);
        expect(stripped).toHaveLength(text.length);
        expect(stripped.split("\n").map((line) => line.length)).toEqual(text.split("\n").map((line) => line.length));
    });

    it("leaves code without comments untouched", () => {
        const text = 'const a = "x";\nfoo(a);\n';
        expect(stripComments(text)).toBe(text);
    });

    it("blanks from a // inside a string literal to the end of the line (a known limit: a miss, never an invention)", () => {
        expect(stripComments('const u = "https://x.y"; run();')).toBe(`const u = "https:${" ".repeat('//x.y"; run();'.length)}`);
    });
});

describe("isShippedSource", () => {
    it.each(["src/main.ts", "src/ui/view.tsx", "src/lib/a.js", "src/a.mjs", "src/preview/stand.ts", "src/deep/er/x.cts"])(
        "counts %s",
        (path) => {
            expect(isShippedSource(path)).toBe(true);
        },
    );

    it.each([
        "scripts/x.js",
        "site/assets/site.js",
        "src/main.test.ts",
        "src/main.spec.ts",
        "src/test/fake.ts",
        "src/tests/fake.ts",
        "src/__mocks__/obsidian.ts",
        "src/__tests__/a.ts",
        "src/styles/main.css",
        "src/data.json",
        "src/node_modules/x/index.js",
        "mysrc/main.ts",
    ])("skips %s", (path) => {
        expect(isShippedSource(path)).toBe(false);
    });
});

describe("checkDomainAssembly", () => {
    it.each([
        'const h = ["forum", "obsidian", "md"].join(".");',
        "const h = ['forum', 'obsidian', 'md'].join('.');",
        'const h = ["https:", "", "forum.obsidian.md"].join("/");',
        'const h = [ "forum" , "md" ] . join ( "." ) ;',
        'const h = ["a", `b`].join(".");',
    ])("flags %s", (line) => {
        const [finding, ...rest] = checkDomainAssembly(file(`\n${line}\n`));
        expect(rest).toEqual([]);
        expect(finding).toMatchObject({ check: "code", file: "src/a.ts", line: 2, rule: "no-domain-assembly" });
        expect(finding?.advisory).toBeUndefined();
    });

    it.each([
        'const s = ["a", "b"].join(", ");',
        'const s = ["a", "b"].join("");',
        "const s = [a, b].join(\".\");",
        'const s = parts.join(".");',
        '// ["forum", "obsidian", "md"].join(".")',
        '/** ["forum", "obsidian", "md"].join(".") */',
        'const s = ["a",\n "b"].join(".");',
    ])("lets %s pass", (code) => {
        expect(checkDomainAssembly(file(`${code}\n`))).toEqual([]);
    });

    it("counts lines through comment blocks", () => {
        const text = '/**\n * Not code.\n */\nconst x = 1;\nconst h = ["a", "b"].join(".");\n';
        expect(checkDomainAssembly(file(text)).map((finding) => finding.line)).toEqual([5]);
    });

    it("reports one finding per line", () => {
        const text = 'const h = ["a", "b"].join("."), g = ["c", "d"].join("/");\n';
        expect(checkDomainAssembly(file(text))).toHaveLength(1);
    });
});

describe("checkTsSuppressions", () => {
    it.each([
        "// @ts-ignore",
        "//@ts-ignore because the stub",
        "    // @ts-expect-error",
        "/* @ts-nocheck */",
        "/** @ts-ignore */",
        "const a = b; // @ts-ignore",
    ])("flags %j as advisory", (line) => {
        const [finding, ...rest] = checkTsSuppressions(file(`x;\n${line}\n`));
        expect(rest).toEqual([]);
        expect(finding).toMatchObject({ check: "code", line: 2, rule: "ts-suppression", advisory: true });
    });

    it.each([
        "// we never use @ts-ignore here",
        'const s = "@ts-ignore";',
        "// ts-ignore",
        "// @ts-check",
        "// @ts-ignored-by-us",
    ])("lets %j pass", (line) => {
        expect(checkTsSuppressions(file(`${line}\n`))).toEqual([]);
    });
});

describe("checkCode", () => {
    it("runs both checks over shipped sources only", () => {
        const bad = '// @ts-ignore\nconst h = ["a", "b"].join(".");\n';
        const findings = checkCode([file(bad, "src/a.ts"), file(bad, "src/a.test.ts"), file(bad, "scripts/x.js")]);
        expect(findings.map((finding) => `${finding.file}:${String(finding.line)}:${finding.rule}`)).toEqual([
            "src/a.ts:2:no-domain-assembly",
            "src/a.ts:1:ts-suppression",
        ]);
    });

    it("finds nothing in clean code", () => {
        expect(checkCode([file("export const a = 1;\n")])).toEqual([]);
    });
});

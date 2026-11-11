import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asRecord, findFormatIssue, loadJson, loadText, stringifyLike } from "./json.js";

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "opdk-release-json-"));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe("asRecord", () => {
    it("returns objects and nothing else", () => {
        expect(asRecord({ a: 1 })).toEqual({ a: 1 });
        for (const value of [null, [], "x", 1, undefined]) {
            expect(asRecord(value)).toBeUndefined();
        }
    });
});

describe("loadJson / loadText", () => {
    it("reads a file, tells missing from invalid", () => {
        writeFileSync(path.join(dir, "a.json"), '{"a":1}');
        writeFileSync(path.join(dir, "bad.json"), "{nope");
        expect(loadJson(path.join(dir, "a.json"))).toEqual({ kind: "ok", text: '{"a":1}', value: { a: 1 } });
        expect(loadJson(path.join(dir, "missing.json"))).toEqual({ kind: "missing" });
        expect(loadJson(path.join(dir, "bad.json")).kind).toBe("invalid");
        expect(loadText(path.join(dir, "missing.md"))).toBeUndefined();
        expect(loadText(path.join(dir, "a.json"))).toBe('{"a":1}');
    });

    it("throws, naming the file, when a path cannot be read at all", () => {
        expect(() => loadJson(dir)).toThrow(/Cannot read/);
        expect(() => loadText(dir)).toThrow(/Cannot read/);
    });
});

describe("stringifyLike", () => {
    it("keeps the indentation (spaces and tabs) and the final newline", () => {
        for (const indent of [2, 4, "\t"]) {
            const original = `${JSON.stringify({ a: { b: 1 }, version: "1.0.0" }, null, indent)}\n`;
            const result = stringifyLike(original, JSON.parse(original), { a: { b: 1 }, version: "1.1.0" }, "x.json");
            expect(result).toBe(original.replace("1.0.0", "1.1.0"));
        }
        const noNewline = JSON.stringify({ version: "1.0.0" }, null, 2);
        expect(stringifyLike(noNewline, JSON.parse(noNewline), { version: "1.1.0" }, "x.json").endsWith("}")).toBe(true);
    });

    it("refuses a one-line file and indents a new object with two spaces", () => {
        expect(() => stringifyLike('{"a":1}', { a: 1 }, { a: 2 }, "x.json")).toThrow(/not formatted the way JSON.stringify writes it/);
        expect(stringifyLike("{}", {}, { a: 2 }, "x.json")).toBe('{\n  "a": 2\n}');
    });

    it("refuses a file that would be reformatted, naming it", () => {
        const aligned = '{\n  "version":   "1.0.0"\n}\n';
        expect(() => stringifyLike(aligned, JSON.parse(aligned), { version: "1.1.0" }, "package.json")).toThrow(/package\.json is not formatted/);
    });

    it("writes a CRLF file back with CRLF, changing only the changed line", () => {
        const original = '{\r\n  "name": "x",\r\n  "version": "1.0.0"\r\n}\r\n';
        const result = stringifyLike(original, JSON.parse(original), { name: "x", version: "1.1.0" }, "package.json");
        expect(result).toBe(original.replace("1.0.0", "1.1.0"));
        const noNewline = '{\r\n  "version": "1.0.0"\r\n}';
        expect(stringifyLike(noNewline, JSON.parse(noNewline), { version: "1.1.0" }, "package.json")).toBe('{\r\n  "version": "1.1.0"\r\n}');
    });

    it("refuses a file that mixes CRLF and LF", () => {
        const mixed = '{\r\n  "name": "x",\n  "version": "1.0.0"\r\n}\n';
        expect(() => stringifyLike(mixed, JSON.parse(mixed), { name: "x", version: "1.1.0" }, "package.json")).toThrow(/package\.json is not formatted/);
    });
});

describe("findFormatIssue", () => {
    it("returns nothing for text that JSON.stringify writes back unchanged", () => {
        for (const text of ['{\n  "a": 1\n}\n', '{\n\t"a": 1\n}\n', '{\r\n    "a": 1\r\n}\r\n', "{}"]) {
            expect(findFormatIssue(text, JSON.parse(text), "x.json")).toBeUndefined();
        }
    });

    it("names the file and gives a hint that is not prettier", () => {
        const issue = findFormatIssue('{"1.7.1": "1.5.0"}', { "1.7.1": "1.5.0" }, "versions.json");
        expect(issue?.message).toBe("versions.json is not formatted the way JSON.stringify writes it (indent, line endings or spacing), so opdk would reformat the whole file.");
        expect(issue?.hint).toContain("node -e");
        expect(issue?.hint).not.toContain("prettier");
    });

    it("reports a file that mixes line endings or aligns values", () => {
        const mixed = '{\r\n  "a": 1,\n  "b": 2\r\n}\n';
        expect(findFormatIssue(mixed, JSON.parse(mixed), "x.json")).toBeDefined();
        const aligned = '{\n  "a":   1\n}\n';
        expect(findFormatIssue(aligned, JSON.parse(aligned), "x.json")).toBeDefined();
    });

    it("gives a hint that, run as written, makes the file pass (one-liner, tabs, 4 spaces, mixed endings)", () => {
        const cases: [string, string][] = [
            ['{"1.7.1": "1.5.0"}', '{\n  "1.7.1": "1.5.0"\n}\n'],
            ['{\n\t"a":   1,\n\t"b": {"c": 2}\n}\n', '{\n\t"a": 1,\n\t"b": {\n\t\t"c": 2\n\t}\n}\n'],
            ['{\n    "a":   1,\n    "b": [1]\n}\n', '{\n    "a": 1,\n    "b": [\n        1\n    ]\n}\n'],
            ['{\r\n  "a": 1,\n  "b": 2\r\n}\n', '{\n  "a": 1,\n  "b": 2\n}\n'],
        ];
        for (const [before, after] of cases) {
            writeFileSync(path.join(dir, "versions.json"), before);
            const hint = findFormatIssue(before, JSON.parse(before), "versions.json")?.hint ?? "";
            const command = /`([^`]+)`/.exec(hint)?.[1] ?? "";
            execFileSync("sh", ["-c", command], { cwd: dir });
            const fixed = readFileSync(path.join(dir, "versions.json"), "utf8");
            expect(fixed).toBe(after);
            expect(findFormatIssue(fixed, JSON.parse(fixed), "versions.json")).toBeUndefined();
        }
    });
});

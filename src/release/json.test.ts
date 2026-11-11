import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asRecord, loadJson, loadText, stringifyLike } from "./json.js";

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

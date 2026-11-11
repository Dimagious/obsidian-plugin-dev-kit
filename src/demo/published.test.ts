import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePublished, PUBLISHED_FILE, readPublished, sameRecord, serializePublished, updatePublished, writePublished } from "./published.js";

let dir: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-demo-published-"));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("parsePublished / serializePublished", () => {
    it("round-trips, sorted by path", () => {
        const text = serializePublished({ "b.gif": "b", "a.gif": "a" });
        expect(text.indexOf("a.gif")).toBeLessThan(text.indexOf("b.gif"));
        expect(parsePublished(text)).toEqual({ "a.gif": "a", "b.gif": "b" });
        expect(parsePublished(serializePublished({}))).toEqual({});
    });

    it("rejects text that is not JSON, the wrong shape, another version, and a non-string film", () => {
        expect(() => parsePublished("{ nope")).toThrow(/published\.json is not valid JSON/);
        expect(() => parsePublished("[]")).toThrow(/not a version 1 record/);
        expect(() => parsePublished('{"version":2,"files":{}}')).toThrow(/not a version 1 record/);
        expect(() => parsePublished('{"version":1}')).toThrow(/not a version 1 record/);
        expect(() => parsePublished('{"version":1,"files":{"a.gif":3}}')).toThrow(/entry for "a\.gif" must be a film name/);
        expect(() => parsePublished('{"version":1,"files":{"a.gif":""}}')).toThrow(/must be a film name/);
    });
});

describe("updatePublished / sameRecord", () => {
    it("drops entries whose file is gone, keeps the others, and adds or re-points what this run wrote", () => {
        const next = updatePublished({ "a.gif": "a", "gone.gif": "gone", "b.gif": "old" }, { "b.gif": "b", "c.gif": "c" }, (file) => file !== "gone.gif");
        expect(next).toEqual({ "a.gif": "a", "b.gif": "b", "c.gif": "c" });
    });

    it("compares by content", () => {
        expect(sameRecord({ "a.gif": "a" }, { "a.gif": "a" })).toBe(true);
        expect(sameRecord({ "a.gif": "a" }, { "a.gif": "b" })).toBe(false);
        expect(sameRecord({ "a.gif": "a" }, { "a.gif": "a", "b.gif": "b" })).toBe(false);
        expect(sameRecord({}, {})).toBe(true);
    });
});

describe("readPublished / writePublished", () => {
    it("reads a missing record as empty", () => {
        expect(readPublished(path.join(dir, "none"))).toEqual({});
    });

    it("writes into a folder that does not exist yet and reads it back", () => {
        const out = path.join(dir, "deep", "demo");
        writePublished(out, { "docs/a.gif": "a" });
        expect(fs.existsSync(path.join(out, PUBLISHED_FILE))).toBe(true);
        expect(readPublished(out)).toEqual({ "docs/a.gif": "a" });
    });

    it("fails on a record that is damaged, and on one that cannot be read at all", () => {
        fs.writeFileSync(path.join(dir, PUBLISHED_FILE), "garbage");
        expect(() => readPublished(dir)).toThrow(/not valid JSON/);
        fs.rmSync(path.join(dir, PUBLISHED_FILE));
        fs.mkdirSync(path.join(dir, PUBLISHED_FILE));
        expect(() => readPublished(dir)).toThrow(/EISDIR/);
    });
});

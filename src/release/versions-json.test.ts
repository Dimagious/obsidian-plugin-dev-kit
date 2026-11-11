import { describe, expect, it } from "vitest";
import type { Loaded } from "./json.js";
import { hasErrors } from "./problems.js";
import { checkVersionsJson } from "./versions-json.js";

const ok = (value: unknown): Loaded => ({ kind: "ok", text: JSON.stringify(value), value });
const messages = (loaded: Loaded, version = "1.2.0", ...minApp: [string | undefined] | []): string[] =>
    checkVersionsJson(loaded, version, minApp.length === 0 ? "1.5.0" : minApp[0]).map((problem) => problem.message);

describe("checkVersionsJson", () => {
    it("passes when the current version maps to minAppVersion and nothing goes down", () => {
        expect(messages(ok({ "1.0.0": "1.0.0", "1.1.0": "1.5.0", "1.2.0": "1.5.0" }))).toEqual([]);
    });

    it("fails with a hint to create the file when it is missing", () => {
        const [problem] = checkVersionsJson({ kind: "missing" }, "1.2.0", "1.5.0");
        expect(problem?.message).toBe("versions.json is missing.");
        expect(problem?.hint).toContain('{ "1.2.0": "1.5.0" }');
    });

    it("fails on invalid JSON and on something that is not an object", () => {
        expect(messages({ kind: "invalid", message: "Unexpected token" })[0]).toContain("not valid JSON: Unexpected token");
        expect(messages(ok(["1.0.0"]))[0]).toContain("must be an object");
        expect(messages(ok(null))[0]).toContain("must be an object");
    });

    it("only warns about a key or a value that is not a version, as upstream does", () => {
        const found = checkVersionsJson(ok({ latest: "1.5.0", "1.2.0": "1.5", "1.1.0": 5 }), "1.2.0", "1.5");
        expect(found.map((problem) => `${problem.severity}: ${problem.message}`)).toEqual([
            'warning: key "latest" is not a version like 1.2.3.',
            'warning: the value of "1.2.0" is not a version like 1.5.0.',
            'warning: the value of "1.1.0" is not a version like 1.5.0.',
        ]);
        expect(hasErrors(found)).toBe(false);
    });

    it("fails when the current version has no entry", () => {
        expect(messages(ok({ "1.0.0": "1.5.0" }))).toEqual(["versions.json has no entry for 1.2.0."]);
    });

    it("fails when the current version maps to something else than minAppVersion", () => {
        expect(messages(ok({ "1.2.0": "1.4.0" }))).toEqual(["versions.json maps 1.2.0 to 1.4.0, but manifest.json minAppVersion is 1.5.0."]);
        expect(messages(ok({ "1.2.0": 3 })).join()).toContain("a non-string");
    });

    it("fails when manifest.json has no minAppVersion", () => {
        expect(messages(ok({ "1.2.0": "1.5.0" }), "1.2.0", undefined)[0]).toContain("has no minAppVersion");
    });

    it("fails when minAppVersion goes down for a higher plugin version, whatever the key order", () => {
        const found = messages(ok({ "1.2.0": "1.5.0", "1.1.0": "1.6.0", "1.0.0": "1.0.0" }));
        expect(found).toEqual(["1.2.0 needs Obsidian 1.5.0, lower than 1.6.0 that 1.1.0 needs."]);
    });

    it("sorts plugin versions by number, not by text", () => {
        expect(messages(ok({ "1.9.0": "1.4.0", "1.10.0": "1.5.0" }), "1.10.0")).toEqual([]);
    });
});

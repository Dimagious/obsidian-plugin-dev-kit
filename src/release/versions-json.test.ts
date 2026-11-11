import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadJson, type Loaded } from "./json.js";
import { hasErrors } from "./problems.js";
import { checkVersionsJson } from "./versions-json.js";

const ok = (value: unknown): Loaded => ({ kind: "ok", text: `${JSON.stringify(value, null, 2)}\n`, value });
const messages = (loaded: Loaded, version = "1.2.0", ...minApp: [string | undefined] | []): string[] =>
    checkVersionsJson(loaded, version, minApp.length === 0 ? "1.5.0" : minApp[0]).map((problem) => problem.message);

describe("checkVersionsJson", () => {
    it("passes when the current version maps to minAppVersion and nothing goes down", () => {
        expect(messages(ok({ "1.0.0": "1.0.0", "1.1.0": "1.5.0", "1.2.0": "1.5.0" }))).toEqual([]);
    });

    it("fails with a hint to create the file when it is missing", () => {
        const [problem] = checkVersionsJson({ kind: "missing" }, "1.2.0", "1.5.0");
        expect(problem?.message).toBe("versions.json is missing.");
        expect(problem?.hint).toContain("node -e");
        expect(problem?.hint).toContain("'1.2.0': '1.5.0'");
    });

    it("writes a file that passes the check when the missing-file hint is run as it says", () => {
        const dir = mkdtempSync(path.join(tmpdir(), "opdk-versions-json-"));
        try {
            const hint = checkVersionsJson({ kind: "missing" }, "1.2.0", "1.5.0")[0]?.hint ?? "";
            const command = /`(node -e [^`]+)`/.exec(hint)?.[1] ?? "";
            expect(command).not.toBe("");
            execFileSync("sh", ["-c", command], { cwd: dir });
            expect(readFileSync(path.join(dir, "versions.json"), "utf8")).toBe('{\n  "1.2.0": "1.5.0"\n}\n');
            expect(checkVersionsJson(loadJson(path.join(dir, "versions.json")), "1.2.0", "1.5.0")).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("gives a command-free hint when minAppVersion is unknown", () => {
        const hint = checkVersionsJson({ kind: "missing" }, "1.2.0", undefined)[0]?.hint ?? "";
        expect(hint).not.toContain("node -e");
        expect(hint).toContain("minAppVersion");
    });

    it("tells a missing entry to be added in the same format", () => {
        const hint = checkVersionsJson(ok({ "1.0.0": "1.5.0" }), "1.2.0", "1.5.0")[0]?.hint ?? "";
        expect(hint).toContain("as a new line in the same format");
        expect(hint).not.toContain('"1.2.0": "1.5.0" }');
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

    it("fails, with a hint that is not prettier, when the file is valid but not written the way opdk writes it", () => {
        const text = '{"1.2.0": "1.5.0"}';
        const found = checkVersionsJson({ kind: "ok", text, value: JSON.parse(text) }, "1.2.0", "1.5.0");
        expect(found.map((problem) => problem.message)).toEqual([expect.stringContaining("versions.json is not formatted the way JSON.stringify writes it")]);
        expect(found[0]?.severity).toBe("error");
        expect(found[0]?.hint).toContain("node -e");
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

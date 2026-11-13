import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testTmpRoot } from "../test-support/test-tmp.js";
import { createRunTests } from "./run-tests.js";

vi.setConfig({ testTimeout: 60_000 });

const dirs: string[] = [];
afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function pluginWithTestScript(script: string): string {
    const dir = mkdtempSync(path.join(testTmpRoot(), "opdk-run-tests-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: script } }));
    return dir;
}

describe("createRunTests", () => {
    it("resolves with 0 when npm test passes and with its exit code when it fails", async () => {
        expect(await createRunTests(pluginWithTestScript("node -e 0"))()).toBe(0);
        expect(await createRunTests(pluginWithTestScript('node -e "process.exit(3)"'))()).toBe(3);
    });

    it("rejects with the fix when npm cannot start", async () => {
        await expect(createRunTests(pluginWithTestScript("node -e 0"), "opdk-no-such-npm")()).rejects.toThrow(/Could not run `opdk-no-such-npm test`.*--no-test/);
    });
});

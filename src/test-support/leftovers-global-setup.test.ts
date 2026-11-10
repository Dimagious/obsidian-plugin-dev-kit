import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAndRemoveRoot, startRun, TEST_TMP_ENV } from "./leftovers-global-setup.js";
import { testTmpRoot } from "./test-tmp.js";

let base: string;

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "opdk-selftest-"));
});

afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
});

describe("startRun and its teardown (real file system)", () => {
    it("publishes a fresh root and passes when the tests removed what they created", () => {
        const env: Record<string, string | undefined> = {};
        const teardown = startRun(base, env);
        const root = env[TEST_TMP_ENV] ?? "";
        expect(path.dirname(root)).toBe(base);
        expect(path.basename(root)).toMatch(/^opdk-kit-tests-/);

        const sandbox = fs.mkdtempSync(path.join(root, "opdk-e2e-vault-"));
        fs.rmSync(sandbox, { recursive: true });
        expect(() => {
            teardown();
        }).not.toThrow();
        expect(fs.existsSync(root)).toBe(false);
    });

    it("fails, naming the folder, when a test left one, and still removes the root", () => {
        const env: Record<string, string | undefined> = {};
        const teardown = startRun(base, env);
        const root = env[TEST_TMP_ENV] ?? "";
        const left = fs.mkdtempSync(path.join(root, "opdk-e2e-userdata-"));
        fs.writeFileSync(path.join(left, "Singleton"), "x");

        expect(() => {
            teardown();
        }).toThrow(path.basename(left));
        expect(fs.existsSync(root)).toBe(false);
    });

    it("keeps the leftover list in the message when the root cannot be removed either", () => {
        const env: Record<string, string | undefined> = {};
        const teardown = startRun(base, env);
        const root = env[TEST_TMP_ENV] ?? "";
        const left = fs.mkdtempSync(path.join(root, "opdk-e2e-vault-"));
        const realRm = fs.rmSync.bind(fs);
        vi.spyOn(fs, "rmSync").mockImplementation((target, rmOptions) => {
            if (String(target) === root) {
                throw new Error("EBUSY");
            }
            realRm(target, rmOptions);
        });
        let message = "";
        try {
            teardown();
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        } finally {
            vi.restoreAllMocks();
        }
        expect(message).toContain(path.basename(left));
        expect(message).toContain("Could not remove the test temp root");
        expect(message).toContain("EBUSY");
        // The mock is gone, so the base folder of this test (and with it the root) is removed by afterEach.
    });

    it("reports only the removal failure when nothing was left", () => {
        const env: Record<string, string | undefined> = {};
        const teardown = startRun(base, env);
        vi.spyOn(fs, "rmSync").mockImplementation(() => {
            throw new Error("EBUSY");
        });
        try {
            expect(() => {
                teardown();
            }).toThrow(/^Could not remove the test temp root .*EBUSY/);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it("ignores files and folders that are not the kit's", () => {
        const env: Record<string, string | undefined> = {};
        const teardown = startRun(base, env);
        const root = env[TEST_TMP_ENV] ?? "";
        fs.mkdirSync(path.join(root, "something-else"));
        fs.writeFileSync(path.join(root, "opdk-e2e-note.txt"), "a file, not a folder");
        expect(() => {
            teardown();
        }).not.toThrow();
    });

    it("gives two runs separate roots, so one cannot blame the other", () => {
        const envA: Record<string, string | undefined> = {};
        const envB: Record<string, string | undefined> = {};
        const teardownA = startRun(base, envA);
        const teardownB = startRun(base, envB);
        expect(envA[TEST_TMP_ENV]).not.toBe(envB[TEST_TMP_ENV]);
        fs.mkdirSync(path.join(envA[TEST_TMP_ENV] ?? "", "opdk-e2e-vault-x"));
        expect(() => {
            teardownB();
        }).not.toThrow();
        expect(() => {
            teardownA();
        }).toThrow("opdk-e2e-vault-x");
    });
});

describe("checkAndRemoveRoot", () => {
    it("lists every leftover", () => {
        fs.mkdirSync(path.join(base, "opdk-e2e-vault-a"));
        fs.mkdirSync(path.join(base, "opdk-e2e-userdata-b"));
        expect(() => {
            checkAndRemoveRoot(base);
        }).toThrow("The tests left 2 opdk-e2e-* folder(s) in " + base + ": opdk-e2e-userdata-b, opdk-e2e-vault-a.");
    });
});

describe("testTmpRoot", () => {
    it("is the root the global setup created for this run, and it is not the shared temp directory", () => {
        const root = testTmpRoot();
        expect(fs.statSync(root).isDirectory()).toBe(true);
        expect(path.basename(root)).toMatch(/^opdk-kit-tests-/);
        expect(root).not.toBe(os.tmpdir());
    });

    it("fails with a pointer to the global setup when the variable is missing", () => {
        expect(() => testTmpRoot({})).toThrow("OPDK_TEST_TMP is not set");
    });
});

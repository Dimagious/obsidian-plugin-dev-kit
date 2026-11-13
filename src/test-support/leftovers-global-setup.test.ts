import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
    checkAndRemoveRoot,
    isProcessAlive,
    OWNER_FILE,
    removeStaleRoots,
    startRun,
    TEST_TMP_ENV,
} from "./leftovers-global-setup.js";
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

    it("reports anything left, any name, files too, but not its own pid file", () => {
        const env: Record<string, string | undefined> = {};
        const teardown = startRun(base, env);
        const root = env[TEST_TMP_ENV] ?? "";
        fs.mkdirSync(path.join(root, "opdk-plugin-x"));
        fs.writeFileSync(path.join(root, "note.txt"), "a file");
        expect(() => {
            teardown();
        }).toThrow(`The tests left 2 item(s) in the run's temp folder ${root}: note.txt, opdk-plugin-x.`);
        expect(fs.existsSync(root)).toBe(false);
    });

    it("points TMPDIR, TMP and TEMP at the root and puts them back afterwards", () => {
        const env: Record<string, string | undefined> = { TMPDIR: "/before", TEMP: "C:\\before" };
        const teardown = startRun(base, env, 4242);
        const root = env[TEST_TMP_ENV] ?? "";
        expect([env.TMPDIR, env.TMP, env.TEMP]).toEqual([root, root, root]);
        expect(fs.readFileSync(path.join(root, OWNER_FILE), "utf8")).toBe("4242");
        teardown();
        expect(env).toEqual({ TMPDIR: "/before", TEMP: "C:\\before", [TEST_TMP_ENV]: root });
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
        }).toThrow(`The tests left 2 item(s) in the run's temp folder ${base}: opdk-e2e-userdata-b, opdk-e2e-vault-a.`);
    });
});

describe("removeStaleRoots", () => {
    function root(name: string, pid?: string): string {
        const dir = path.join(base, name);
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "left.txt"), "x");
        if (pid !== undefined) {
            fs.writeFileSync(path.join(dir, OWNER_FILE), pid);
        }
        return dir;
    }

    it("removes the roots of runs whose process is gone and keeps live, unknown and other folders", () => {
        root("opdk-kit-tests-dead", "111");
        const live = root("opdk-kit-tests-live", "222");
        const noPid = root("opdk-kit-tests-nopid");
        const garbled = root("opdk-kit-tests-garbled", "not a pid");
        const other = root("opdk-plugin-dead", "111");
        const removed = removeStaleRoots(base, (pid) => pid === 222);
        expect(removed).toEqual(["opdk-kit-tests-dead"]);
        expect(fs.existsSync(path.join(base, "opdk-kit-tests-dead"))).toBe(false);
        for (const kept of [live, noPid, garbled, other]) {
            expect(fs.existsSync(kept)).toBe(true);
        }
    });

    it("runs before a new root is made, so a killed run's root is gone after the next start", () => {
        root("opdk-kit-tests-killed", "111");
        const env: Record<string, string | undefined> = {};
        const teardown = startRun(base, env, 333, (pid) => pid === 333);
        expect(fs.readdirSync(base)).toEqual([path.basename(env[TEST_TMP_ENV] ?? "")]);
        teardown();
    });
});

describe("isProcessAlive", () => {
    it("is true for this process and false for one that has exited", () => {
        expect(isProcessAlive(process.pid)).toBe(true);
        const child = spawnSync(process.execPath, ["-e", ""]);
        expect(child.pid).toBeGreaterThan(0);
        expect(isProcessAlive(child.pid)).toBe(false);
    });
});

describe("testTmpRoot", () => {
    it("is the root the global setup created for this run", () => {
        const root = testTmpRoot();
        expect(fs.statSync(root).isDirectory()).toBe(true);
        expect(path.basename(root)).toMatch(/^opdk-kit-tests-/);
    });

    it("is where os.tmpdir() points in a worker, so a forgotten temp folder is caught", () => {
        expect(os.tmpdir()).toBe(testTmpRoot());
    });

    it("fails with a pointer to the global setup when the variable is missing", () => {
        expect(() => testTmpRoot({})).toThrow("OPDK_TEST_TMP is not set");
    });
});

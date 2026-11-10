import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testTmpRoot } from "../test-support/test-tmp.js";
import {
    CleanupStack,
    createTempDir,
    listTempDirs,
    removeDir,
    sweepAtWorkerStart,
    sweepLeftovers,
    TEMP_PREFIX,
} from "./cleanup.js";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(testTmpRoot(), `${TEMP_PREFIX}test-`));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("CleanupStack", () => {
    it("runs the steps newest first", async () => {
        const order: string[] = [];
        const stack = new CleanupStack();
        stack.add("a", () => void order.push("a"));
        stack.add("b", () => void order.push("b"));
        stack.add("c", async () => {
            await Promise.resolve();
            order.push("c");
        });
        await stack.run();
        expect(order).toEqual(["c", "b", "a"]);
    });

    it("runs every step even when one fails, and names each failure", async () => {
        const order: string[] = [];
        const stack = new CleanupStack();
        stack.add("first", () => void order.push("first"));
        stack.add("second", () => {
            throw new Error("boom two");
        });
        stack.add("third", () => {
            throw new Error("boom three");
        });
        const error = await stack.run().then(
            () => undefined,
            (caught: unknown) => caught,
        );
        expect(order).toEqual(["first"]);
        expect(error).toBeInstanceOf(AggregateError);
        const message = (error as Error).message;
        expect(message).toContain("- second: boom two");
        expect(message).toContain("- third: boom three");
    });

    it("runs each step once", async () => {
        let count = 0;
        const stack = new CleanupStack();
        stack.add("a", () => void (count += 1));
        await stack.run();
        await stack.run();
        expect(count).toBe(1);
    });

    it("does nothing for an empty stack", async () => {
        await expect(new CleanupStack().run()).resolves.toBeUndefined();
    });
});

describe("removeDir", () => {
    it("removes a folder with content", () => {
        const dir = path.join(root, "x");
        fs.mkdirSync(path.join(dir, "deep"), { recursive: true });
        fs.writeFileSync(path.join(dir, "deep", "f"), "1");
        removeDir(dir);
        expect(fs.existsSync(dir)).toBe(false);
    });

    it("accepts a folder that is already gone", () => {
        expect(() => {
            removeDir(path.join(root, "never-existed"));
        }).not.toThrow();
    });

    it("asks for retries", () => {
        const rm = vi.fn();
        removeDir("/some/dir", { rm });
        expect(rm).toHaveBeenCalledWith("/some/dir", { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });

    it("throws with the path when the folder cannot be removed", () => {
        const rm = vi.fn(() => {
            throw new Error("ENOTEMPTY: directory not empty");
        });
        expect(() => {
            removeDir("/some/dir", { rm });
        }).toThrow(/Could not remove \/some\/dir after retries: ENOTEMPTY: directory not empty/);
    });
});

describe("createTempDir", () => {
    it("creates a folder with the kit prefix, kind and a cleaned label", () => {
        const dir = createTempDir("vault", "Opens the Settings! (mobile)", root);
        expect(path.dirname(dir)).toBe(root);
        expect(path.basename(dir)).toMatch(/^opdk-e2e-vault-opens-the-settings-mobile-[A-Za-z0-9]{6}$/);
        expect(fs.statSync(dir).isDirectory()).toBe(true);
    });

    it("cuts a long label and survives an empty one", () => {
        const long = path.basename(createTempDir("vault", "x".repeat(200), root));
        expect(long).toBe(`opdk-e2e-vault-${"x".repeat(40)}-${long.slice(-6)}`);
        expect(path.basename(createTempDir("userdata", "", root))).toMatch(/^opdk-e2e-userdata-[A-Za-z0-9]{6}$/);
        expect(path.basename(createTempDir("vault", "!!!", root))).toMatch(/^opdk-e2e-vault-[A-Za-z0-9]{6}$/);
    });
});

describe("sweepLeftovers", () => {
    const hour = 3_600_000;
    const age = (dir: string, hours: number, now: number): void => {
        const time = new Date(now - hours * hour);
        fs.utimesSync(dir, time, time);
    };

    it("removes old kit folders and keeps young ones and everything else", () => {
        const now = Date.now();
        const old = createTempDir("vault", "old", root);
        const young = createTempDir("vault", "young", root);
        const foreign = path.join(root, "someone-elses-dir");
        const looksLikeOurs = path.join(root, "not-opdk-e2e-dir");
        const file = path.join(root, `${TEMP_PREFIX}file`);
        fs.mkdirSync(foreign);
        fs.mkdirSync(looksLikeOurs);
        fs.writeFileSync(file, "x");
        for (const dir of [old, foreign, looksLikeOurs]) {
            age(dir, 5, now);
        }
        age(young, 1, now);
        fs.utimesSync(file, new Date(now - 5 * hour), new Date(now - 5 * hour));

        const result = sweepLeftovers({ root, olderThanHours: 2, now });

        expect(result).toEqual({ removed: [old], failed: [] });
        expect(fs.existsSync(old)).toBe(false);
        for (const kept of [young, foreign, looksLikeOurs, file]) {
            expect(fs.existsSync(kept)).toBe(true);
        }
    });

    it("keeps a folder just inside the cutoff", () => {
        // One second inside, not exactly at it: utimes stores the time with a rounding that, on Linux CI, put a
        // folder set to the cutoff a fraction of a millisecond older than it, and the sweep removed it.
        const now = Date.now();
        const dir = createTempDir("vault", "edge", root);
        age(dir, 2 - 1 / 3600, now);
        expect(sweepLeftovers({ root, olderThanHours: 2, now }).removed).toEqual([]);
    });

    it("never follows a symlink named like a kit folder", () => {
        const now = Date.now();
        const target = path.join(root, "precious");
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, "keep"), "1");
        fs.symlinkSync(target, path.join(root, `${TEMP_PREFIX}link`));
        age(target, 9, now);
        expect(sweepLeftovers({ root, olderThanHours: 2, now }).removed).toEqual([]);
        expect(fs.existsSync(path.join(target, "keep"))).toBe(true);
    });

    it("reports a folder it cannot remove instead of throwing", () => {
        const now = Date.now();
        const stuck = createTempDir("vault", "stuck", root);
        const fine = createTempDir("vault", "fine", root);
        age(stuck, 5, now);
        age(fine, 5, now);
        const rm = vi.fn((target: fs.PathLike) => {
            if (String(target) === stuck) {
                throw new Error("EBUSY");
            }
            fs.rmSync(target, { recursive: true, force: true });
        });
        const result = sweepLeftovers({ root, olderThanHours: 2, now, rm });
        expect(result.removed).toEqual([fine]);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]?.dir).toBe(stuck);
        expect(result.failed[0]?.error).toContain("EBUSY");
    });

    it("uses the OS temp folder by default without touching foreign names", () => {
        // A far-future cutoff of 1e9 hours removes nothing, so this only proves the default root is readable.
        expect(sweepLeftovers({ olderThanHours: 1e9 }).removed).toEqual([]);
    });
});

describe("listTempDirs", () => {
    it("lists only kit folders, sorted", () => {
        const a = path.basename(createTempDir("vault", "b", root));
        const b = path.basename(createTempDir("userdata", "a", root));
        fs.mkdirSync(path.join(root, "other"));
        expect(listTempDirs(root)).toEqual([a, b].sort());
    });
});

describe("sweepAtWorkerStart", () => {
    const old = (name: string): string => {
        const dir = createTempDir("vault", name, root);
        const time = new Date(Date.now() - 5 * 3_600_000);
        fs.utimesSync(dir, time, time);
        return dir;
    };

    it("does nothing when switched off", () => {
        const dir = old("a");
        const warn = vi.fn();
        sweepAtWorkerStart(false, warn, root);
        expect(fs.existsSync(dir)).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    it("removes old folders and says how many", () => {
        old("a");
        old("b");
        const warn = vi.fn();
        sweepAtWorkerStart(2, warn, root);
        expect(listTempDirs(root)).toEqual([]);
        expect(warn).toHaveBeenCalledWith("[e2e] removed 2 leftover folder(s) from earlier runs.");
    });

    it("stays quiet when there is nothing to remove", () => {
        const warn = vi.fn();
        sweepAtWorkerStart(2, warn, root);
        expect(warn).not.toHaveBeenCalled();
    });

    it("warns with the path when a folder cannot be removed", () => {
        const dir = old("stuck");
        const warn = vi.fn();
        const realRm = fs.rmSync.bind(fs);
        const spy = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
            if (String(target) === dir) {
                throw new Error("EBUSY");
            }
            realRm(target, options);
        });
        sweepAtWorkerStart(2, warn, root);
        spy.mockRestore();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`could not remove leftover ${dir}`));
    });
});

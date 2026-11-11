import { describe, expect, it, vi } from "vitest";
import { createContext } from "../test-support/plugin-fixture.js";
import { CleanupSet, guardInterrupt, INTERRUPTED_EXIT } from "./interrupt.js";

describe("CleanupSet", () => {
    it("runs each action once, in order of registration", () => {
        const set = new CleanupSet();
        const calls: string[] = [];
        set.add(() => {
            calls.push("a");
        });
        set.add(() => {
            calls.push("b");
        });
        set.run();
        set.run();
        expect(calls).toEqual(["a", "b"]);
    });

    it("does not run an action that was taken off the list", () => {
        const set = new CleanupSet();
        const action = vi.fn();
        set.add(action)();
        set.run();
        expect(action).not.toHaveBeenCalled();
    });

    it("runs the other actions when one throws, then throws that error", () => {
        const set = new CleanupSet();
        const after = vi.fn();
        set.add(() => {
            throw new Error("disk is read-only");
        });
        set.add(after);
        expect(() => {
            set.run();
        }).toThrow("disk is read-only");
        expect(after).toHaveBeenCalledOnce();
    });
});

describe("guardInterrupt", () => {
    function hooks() {
        const listeners: (() => void)[] = [];
        const exit = vi.fn();
        const off = vi.fn();
        return {
            listeners,
            exit,
            off,
            value: {
                onInterrupt: (listener: () => void) => {
                    listeners.push(listener);
                    return off;
                },
                exit,
            },
        };
    }

    it("does nothing without hooks", () => {
        const guard = guardInterrupt(undefined, new CleanupSet(), createContext("/x").reporter);
        expect(guard.interrupted()).toBe(false);
        guard.stop();
    });

    it("runs the cleanups, says so and exits with 130 on Ctrl+C", () => {
        const set = new CleanupSet();
        const action = vi.fn();
        set.add(action);
        const ctx = createContext("/x");
        const fake = hooks();
        const guard = guardInterrupt(fake.value, set, ctx.reporter);
        fake.listeners[0]?.();
        expect(action).toHaveBeenCalledOnce();
        expect(fake.exit).toHaveBeenCalledWith(INTERRUPTED_EXIT);
        expect(INTERRUPTED_EXIT).toBe(130);
        expect(guard.interrupted()).toBe(true);
        expect(ctx.out.join("")).toContain("interrupted: restoring the files and removing the temp folders");
    });

    it("reports a cleanup that failed, still exits with 130", () => {
        const set = new CleanupSet();
        set.add(() => {
            throw new Error("EROFS");
        });
        const ctx = createContext("/x");
        const fake = hooks();
        guardInterrupt(fake.value, set, ctx.reporter);
        fake.listeners[0]?.();
        expect(ctx.err.join("")).toContain("cleanup after Ctrl+C failed: EROFS");
        expect(ctx.err.join("")).toContain("git status");
        expect(fake.exit).toHaveBeenCalledWith(130);
    });

    it("unregisters once however often stop is called", () => {
        const fake = hooks();
        const guard = guardInterrupt(fake.value, new CleanupSet(), createContext("/x").reporter);
        guard.stop();
        guard.stop();
        expect(fake.off).toHaveBeenCalledOnce();
    });
});

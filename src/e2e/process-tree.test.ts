import { describe, expect, it } from "vitest";
import { createProcessIo, isTreeAlive, terminateTree, type ProcessIo, type SpawnResult } from "./process-tree.js";

type Behavior = "dies-on-term" | "dies-on-kill" | "immortal" | "already-gone" | "vanishes";

/** A process group that dies (or not) on the signals the behaviour says. `deniedAfter` makes probes fail with EPERM. */
function fakeIo(
    behavior: Behavior,
    platform: NodeJS.Platform = "darwin",
    errors: Partial<Record<NodeJS.Signals | "probe", string>> = {},
    taskkill: SpawnResult = { status: 0, stderr: "" },
): { io: ProcessIo; calls: { pid: number; signal: NodeJS.Signals | 0 }[]; sleeps: number[]; spawned: string[] } {
    const calls: { pid: number; signal: NodeJS.Signals | 0 }[] = [];
    const spawned: string[] = [];
    const sleeps: number[] = [];
    let alive = behavior !== "already-gone";
    const io: ProcessIo = {
        platform,
        sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
        },
        kill: (pid, signal) => {
            calls.push({ pid, signal });
            const code = signal === 0 ? errors.probe : errors[signal];
            if (code !== undefined) {
                throw Object.assign(new Error(`kill ${code}`), { code });
            }
            if (signal === 0) {
                if (!alive) {
                    throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
                }
                return;
            }
            if (behavior === "vanishes") {
                // The group exited after the probe and before the signal.
                alive = false;
                throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
            }
            if ((signal === "SIGTERM" && behavior === "dies-on-term") || (signal === "SIGKILL" && behavior !== "immortal")) {
                alive = false;
            }
        },
        spawnSync: (command, args) => {
            spawned.push([command, ...args].join(" "));
            if (behavior !== "immortal" && (taskkill.status === 0 || taskkill.status === 128)) {
                alive = false;
            }
            return taskkill;
        },
    };
    return { io, calls, sleeps, spawned };
}

describe("isTreeAlive", () => {
    it("probes the group with signal 0", () => {
        const { io, calls } = fakeIo("immortal");
        expect(isTreeAlive(100, io)).toBe(true);
        expect(calls).toEqual([{ pid: -100, signal: 0 }]);
    });

    it("is false on ESRCH", () => {
        expect(isTreeAlive(100, fakeIo("already-gone").io)).toBe(false);
    });

    it("is true on EPERM: it exists but is not ours to signal", () => {
        expect(isTreeAlive(100, fakeIo("immortal", "darwin", { probe: "EPERM" }).io)).toBe(true);
    });

    it("rethrows any other error", () => {
        expect(() => isTreeAlive(100, fakeIo("immortal", "darwin", { probe: "EINVAL" }).io)).toThrow("EINVAL");
    });

    it("targets the single pid on Windows", () => {
        const { io, calls } = fakeIo("immortal", "win32");
        isTreeAlive(100, io);
        expect(calls).toEqual([{ pid: 100, signal: 0 }]);
    });
});

describe("terminateTree", () => {
    it.each([0, 1, -5, Number.NaN, 1.5])("refuses pid %s before sending any signal", async (pid) => {
        const { io, calls } = fakeIo("dies-on-term");
        await expect(terminateTree(pid, io)).rejects.toThrow(/not a usable process id/);
        expect(calls).toEqual([]);
    });

    it("does nothing when the group is already gone", async () => {
        const { io, calls } = fakeIo("already-gone");
        await expect(terminateTree(100, io)).resolves.toBe("gone");
        expect(calls.filter((call) => call.signal !== 0)).toEqual([]);
    });

    it("stops at SIGTERM when that is enough", async () => {
        const { io, calls } = fakeIo("dies-on-term");
        await expect(terminateTree(100, io)).resolves.toBe("terminated");
        expect(calls.filter((call) => call.signal !== 0)).toEqual([{ pid: -100, signal: "SIGTERM" }]);
    });

    it("escalates to SIGKILL on the group when SIGTERM is ignored, polling in between", async () => {
        const { io, calls, sleeps } = fakeIo("dies-on-kill");
        await expect(terminateTree(100, io, { polls: 3, pollMs: 10 })).resolves.toBe("killed");
        expect(calls.filter((call) => call.signal !== 0)).toEqual([
            { pid: -100, signal: "SIGTERM" },
            { pid: -100, signal: "SIGKILL" },
        ]);
        expect(sleeps).toEqual([10, 10, 10]);
    });

    it("throws with the manual command when a process survives SIGKILL", async () => {
        const { io } = fakeIo("immortal");
        await expect(terminateTree(100, io, { polls: 2, pollMs: 1 })).rejects.toThrow(
            "Obsidian process 100 (and its helpers) survived SIGKILL. Kill it by hand (kill -9 -100).",
        );
    });

    it("tolerates a group that vanishes between the probe and the signal", async () => {
        const { io, calls } = fakeIo("vanishes");
        await expect(terminateTree(100, io, { polls: 1, pollMs: 1 })).resolves.toBe("terminated");
        expect(calls.filter((call) => call.signal === "SIGKILL")).toEqual([]);
    });

    it("goes on to SIGKILL when SIGTERM reports ESRCH but the group is still seen alive", async () => {
        const { io, calls } = fakeIo("dies-on-kill", "darwin", { SIGTERM: "ESRCH" });
        await expect(terminateTree(100, io, { polls: 1, pollMs: 1 })).resolves.toBe("killed");
        expect(calls.map((call) => call.signal)).toEqual([0, "SIGTERM", 0, 0, "SIGKILL", 0]);
    });

    /** A group that exits right after the first probe; the signal then fails with `signalCode` (macOS answers EPERM). */
    function exitsBeforeSignal(signalCode: string): { io: ProcessIo; calls: (NodeJS.Signals | 0)[] } {
        const calls: (NodeJS.Signals | 0)[] = [];
        let alive = true;
        const io: ProcessIo = {
            platform: "darwin",
            sleep: () => Promise.resolve(),
            spawnSync: () => ({ status: 0, stderr: "" }),
            kill: (_pid, signal) => {
                calls.push(signal);
                if (signal === 0) {
                    if (!alive) {
                        throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
                    }
                    return;
                }
                alive = false;
                throw Object.assign(new Error(`kill ${signalCode}`), { code: signalCode });
            },
        };
        return { io, calls };
    }

    it("treats EPERM on the signal as success when a signal-0 probe then finds the group gone", async () => {
        const { io, calls } = exitsBeforeSignal("EPERM");
        await expect(terminateTree(100, io, { polls: 1, pollMs: 1 })).resolves.toBe("terminated");
        expect(calls).toEqual([0, "SIGTERM", 0, 0]);
    });

    it("still fails on EPERM when the probe shows the group is alive", async () => {
        const { io } = fakeIo("immortal", "darwin", { SIGTERM: "EPERM" });
        await expect(terminateTree(100, io)).rejects.toThrow("EPERM");
    });

    it("surfaces a signal error other than ESRCH", async () => {
        const { io } = fakeIo("dies-on-term", "darwin", { SIGTERM: "EPERM" });
        await expect(terminateTree(100, io)).rejects.toThrow("EPERM");
    });
});

describe("terminateTree on Windows", () => {
    it("ends the tree with taskkill /T /F, not with process.kill, because the pid is cmd.exe's", async () => {
        const { io, calls, spawned } = fakeIo("dies-on-term", "win32");
        await expect(terminateTree(100, io)).resolves.toBe("killed");
        expect(spawned).toEqual(["taskkill /PID 100 /T /F"]);
        // Only the liveness probe goes through process.kill; no SIGTERM/SIGKILL is sent to the shell.
        expect(calls.every((call) => call.signal === 0 && call.pid === 100)).toBe(true);
    });

    it("does nothing when the process is already gone", async () => {
        const { io, spawned } = fakeIo("already-gone", "win32");
        await expect(terminateTree(100, io)).resolves.toBe("gone");
        expect(spawned).toEqual([]);
    });

    it("accepts taskkill's exit code 128 (no such process): the tree vanished first", async () => {
        const { io } = fakeIo("dies-on-term", "win32", {}, { status: 128, stderr: "not found" });
        await expect(terminateTree(100, io)).resolves.toBe("killed");
    });

    it("fails with the manual command when taskkill cannot be started", async () => {
        const error = new Error("spawnSync taskkill ENOENT");
        const { io } = fakeIo("immortal", "win32", {}, { status: null, stderr: "", error });
        await expect(terminateTree(100, io)).rejects.toThrow(/Could not run taskkill.*ENOENT.*taskkill \/PID 100 \/T \/F/s);
    });

    it("fails with taskkill's message on an unexpected exit code", async () => {
        const { io } = fakeIo("immortal", "win32", {}, { status: 1, stderr: "Access is denied.\n" });
        await expect(terminateTree(100, io)).rejects.toThrow("exit code 1: Access is denied.");
    });

    it("throws with the manual command when the process survives taskkill", async () => {
        const { io } = fakeIo("immortal", "win32");
        await expect(terminateTree(100, io, { polls: 2, pollMs: 1 })).rejects.toThrow(
            "Obsidian process 100 (and its helpers) survived taskkill. Kill it by hand (taskkill /PID 100 /T /F).",
        );
    });
});

describe("createProcessIo", () => {
    it("probes a live process with signal 0 and reports a gone one as ESRCH", async () => {
        const io = createProcessIo();
        expect(io.platform).toBe(process.platform);
        expect(isTreeAlive(process.pid, { ...io, platform: "win32" })).toBe(true);
        await io.sleep(1);
        // A pid this high does not exist on any supported system.
        expect(isTreeAlive(2 ** 22 + 12345, { ...io, platform: "win32" })).toBe(false);
    });
});

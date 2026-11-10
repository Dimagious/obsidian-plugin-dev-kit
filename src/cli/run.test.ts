import { describe, expect, it } from "vitest";
import { createReporter } from "./reporter.js";
import { createRegistry } from "./registry.js";
import { runCli } from "./run.js";
import type { Command, CommandContext } from "./types.js";

interface Harness {
    readonly out: string[];
    readonly err: string[];
    run(argv: string[], commands?: Command[], env?: Record<string, string>): Promise<number>;
}

function harness(): Harness {
    const out: string[] = [];
    const err: string[] = [];
    return {
        out,
        err,
        run: (argv, commands = [], env = {}) => {
            const stdout = (text: string): void => {
                out.push(text);
            };
            const stderr = (text: string): void => {
                err.push(text);
            };
            const ctx: CommandContext = {
                cwd: "/plugin",
                env,
                stdout,
                stderr,
                reporter: createReporter({ stdout, stderr, colorStdout: false, colorStderr: false }),
            };
            return runCli(argv, { registry: createRegistry(commands), version: "9.9.9", ctx });
        },
    };
}

const echo: Command = {
    name: "echo",
    summary: "Print the args",
    usage: "Usage: opdk echo <text>\n",
    run: (args, ctx) => {
        ctx.stdout(`${args.join(" ")}\n`);
        return Promise.resolve(args.length === 0 ? 3 : 0);
    },
};

const boom: Command = {
    name: "boom",
    summary: "Always fails",
    usage: "Usage: opdk boom",
    run: () => Promise.reject(new Error("disk on fire")),
};

describe("runCli", () => {
    it("prints help with the roadmap link when no commands are registered", async () => {
        const h = harness();
        expect(await h.run([])).toBe(0);
        const text = h.out.join("");
        expect(text).toContain("opdk 9.9.9");
        expect(text).toContain("No commands are registered yet");
        expect(text).toContain("#roadmap");
    });

    it("lists registered commands with their summaries for --help and -h", async () => {
        for (const flag of ["--help", "-h"]) {
            const h = harness();
            expect(await h.run([flag], [echo, boom])).toBe(0);
            const text = h.out.join("");
            expect(text).toContain("echo  Print the args");
            expect(text).toContain("boom  Always fails");
            expect(text).not.toContain("No commands are registered");
        }
    });

    it("prints the version", async () => {
        const h = harness();
        expect(await h.run(["--version"])).toBe(0);
        expect(h.out.join("")).toBe("9.9.9\n");
    });

    it("runs a command with its args and returns its exit code", async () => {
        const h = harness();
        expect(await h.run(["echo", "a", "b"], [echo])).toBe(0);
        expect(h.out.join("")).toBe("a b\n");
        expect(await h.run(["echo"], [echo])).toBe(3);
    });

    it("prints a command's usage for <cmd> --help without running it", async () => {
        const h = harness();
        expect(await h.run(["echo", "--help"], [echo])).toBe(0);
        expect(h.out.join("")).toBe("Usage: opdk echo <text>\n");
    });

    it("exits 1 naming the command when it is unknown", async () => {
        const h = harness();
        expect(await h.run(["nope"], [echo])).toBe(1);
        expect(h.err.join("")).toBe('✗ opdk: unknown command "nope". Run "opdk --help" to list the available commands.\n');
        expect(h.out).toEqual([]);
    });

    it("exits 1 for <unknown> --help too", async () => {
        const h = harness();
        expect(await h.run(["nope", "--help"])).toBe(1);
        expect(h.err.join("")).toContain('unknown command "nope"');
    });

    it("reports a throwing command by name and exits 1, without a stack", async () => {
        const h = harness();
        expect(await h.run(["boom"], [boom])).toBe(1);
        const text = h.err.join("");
        expect(text).toBe('✗ opdk: command "boom" failed: disk on fire\n');
        expect(text).not.toContain("at ");
    });

    it("adds the stack when OPDK_DEBUG=1", async () => {
        const h = harness();
        expect(await h.run(["boom"], [boom], { OPDK_DEBUG: "1" })).toBe(1);
        expect(h.err.join("")).toMatch(/Error: disk on fire\n\s+at /);
    });

    it("does not add the stack for other OPDK_DEBUG values", async () => {
        const h = harness();
        await h.run(["boom"], [boom], { OPDK_DEBUG: "0" });
        expect(h.err).toHaveLength(1);
    });

    it("handles a command that rejects with a non-Error value", async () => {
        const stringy: Command = {
            ...boom,
            name: "stringy",
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point of the test
            run: () => Promise.reject("plain string"),
        };
        const h = harness();
        expect(await h.run(["stringy"], [stringy], { OPDK_DEBUG: "1" })).toBe(1);
        expect(h.err.join("")).toBe('✗ opdk: command "stringy" failed: plain string\n');
    });
});

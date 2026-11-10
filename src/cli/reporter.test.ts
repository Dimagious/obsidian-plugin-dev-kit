import { describe, expect, it } from "vitest";
import { createReporter, shouldColor, STEP_WIDTH } from "./reporter.js";

describe("shouldColor", () => {
    const cases: readonly { name: string; isTTY: boolean; env: Record<string, string>; expected: boolean }[] = [
        { name: "a terminal", isTTY: true, env: {}, expected: true },
        { name: "a pipe", isTTY: false, env: {}, expected: false },
        { name: "NO_COLOR=1 on a terminal", isTTY: true, env: { NO_COLOR: "1" }, expected: false },
        { name: "any non-empty NO_COLOR", isTTY: true, env: { NO_COLOR: "yes please" }, expected: false },
        { name: "an empty NO_COLOR (no-color.org: ignored)", isTTY: true, env: { NO_COLOR: "" }, expected: true },
        { name: "NO_COLOR beats FORCE_COLOR", isTTY: false, env: { NO_COLOR: "1", FORCE_COLOR: "1" }, expected: false },
        { name: "FORCE_COLOR=1 on a pipe", isTTY: false, env: { FORCE_COLOR: "1" }, expected: true },
        { name: "FORCE_COLOR=true on a pipe", isTTY: false, env: { FORCE_COLOR: "true" }, expected: true },
        { name: "FORCE_COLOR=0 on a terminal", isTTY: true, env: { FORCE_COLOR: "0" }, expected: false },
        { name: "TERM=dumb on a terminal", isTTY: true, env: { TERM: "dumb" }, expected: false },
        { name: "FORCE_COLOR=1 beats TERM=dumb", isTTY: false, env: { TERM: "dumb", FORCE_COLOR: "1" }, expected: true },
        { name: "an empty FORCE_COLOR on a pipe", isTTY: false, env: { FORCE_COLOR: "" }, expected: true },
        { name: "FORCE_COLOR=false on a terminal", isTTY: true, env: { FORCE_COLOR: "false" }, expected: false },
        { name: "GITHUB_ACTIONS=true on a pipe", isTTY: false, env: { GITHUB_ACTIONS: "true" }, expected: true },
        { name: "GITHUB_ACTIONS=true with NO_COLOR=1", isTTY: false, env: { GITHUB_ACTIONS: "true", NO_COLOR: "1" }, expected: false },
        { name: "TERM=xterm-256color on a terminal", isTTY: true, env: { TERM: "xterm-256color" }, expected: true },
    ];
    for (const { name, isTTY, env, expected } of cases) {
        it(`${expected ? "colours" : "does not colour"} ${name}`, () => {
            expect(shouldColor({ isTTY, env })).toBe(expected);
        });
    }
});

function capture(color: { stdout: boolean; stderr: boolean }): { out: string[]; err: string[]; reporter: ReturnType<typeof createReporter> } {
    const out: string[] = [];
    const err: string[] = [];
    const reporter = createReporter({
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        colorStdout: color.stdout,
        colorStderr: color.stderr,
    });
    return { out, err, reporter };
}

describe("reporter in plain mode", () => {
    it("prints results to stdout with the step padded to a fixed column", () => {
        const { out, err, reporter } = capture({ stdout: false, stderr: false });
        reporter.success("css", "a -> b (2 files, 4 lines)");
        reporter.success("bundle", "main.js is free of Node-only references (0.6 KB)");
        reporter.info("build", "hello: bundling src/main.ts");
        reporter.warn("css", "no src/styles/main.css, keeping styles.css as is");
        expect(out.join("")).toBe(
            [
                "✓ css     a -> b (2 files, 4 lines)",
                "✓ bundle  main.js is free of Node-only references (0.6 KB)",
                "· build   hello: bundling src/main.ts",
                "! css     no src/styles/main.css, keeping styles.css as is",
                "",
            ].join("\n"),
        );
        expect(err).toEqual([]);
    });

    it("prints a failure to stderr with details and the hint indented under it", () => {
        const { out, err, reporter } = capture({ stdout: false, stderr: false });
        reporter.failure("bundle", "main.js cannot run on mobile:", {
            details: ['- a `process` reference: "process.env"'],
            hint: "Check the esbuild platform.",
        });
        expect(err.join("")).toBe(
            [
                "✗ bundle  main.js cannot run on mobile:",
                '            - a `process` reference: "process.env"',
                "          Check the esbuild platform.",
                "",
            ].join("\n"),
        );
        expect(out).toEqual([]);
    });

    it("prints a failure without extras as one line", () => {
        const { err, reporter } = capture({ stdout: false, stderr: false });
        reporter.failure("build", "x: failed");
        expect(err.join("")).toBe("✗ build   x: failed\n");
    });

    it("lets a step name longer than the column push the message right instead of cutting it", () => {
        const { out, reporter } = capture({ stdout: false, stderr: false });
        reporter.success("a-long-step", "ok");
        expect(out.join("")).toBe("✓ a-long-step  ok\n");
        expect("a-long-step".length).toBeGreaterThan(STEP_WIDTH);
    });

    it("prints a step-less error with indented lines", () => {
        const { err, reporter } = capture({ stdout: false, stderr: false });
        reporter.error("opdk: boom", ["Error: boom", "    at x"]);
        expect(err.join("")).toBe("✗ opdk: boom\n  Error: boom\n      at x\n");
    });

    it("writes raw text as is", () => {
        const { err, reporter } = capture({ stdout: false, stderr: false });
        reporter.rawStderr("▲ [WARNING] x\n");
        expect(err).toEqual(["▲ [WARNING] x\n"]);
        expect(reporter.colorStderr).toBe(false);
    });

    it("never emits an escape byte", () => {
        const { out, err, reporter } = capture({ stdout: false, stderr: false });
        reporter.success("css", "a");
        reporter.info("css", "a");
        reporter.warn("css", "a");
        reporter.failure("css", "a", { details: ["d"], hint: "h" });
        reporter.error("e", ["d"]);
        expect([...out, ...err].join("")).not.toContain("\u001b");
    });
});

describe("reporter in colour mode", () => {
    const RESET = "\u001b[0m";

    it("paints a success green and a failure red, each segment closed with a reset", () => {
        const { out, err, reporter } = capture({ stdout: true, stderr: true });
        reporter.success("css", "done");
        reporter.failure("bundle", "broken", { details: ["- why"], hint: "do this" });
        const ok = out.join("");
        expect(ok).toContain("\u001b[32m✓\u001b[0m");
        expect(ok).toContain("\u001b[1;32mcss   \u001b[0m");
        expect(ok).toContain("\u001b[32mdone\u001b[0m");
        expect(ok.endsWith(`${RESET}\n`)).toBe(true);

        const bad = err.join("");
        expect(bad).toContain("\u001b[31m✗\u001b[0m");
        expect(bad).toContain("\u001b[31mbroken\u001b[0m");
        expect(bad).toContain("\u001b[31m- why\u001b[0m");
        expect(bad).toContain("\u001b[33mdo this\u001b[0m");
        expect(bad).not.toContain("\u001b[32m");
    });

    it("paints warnings yellow and progress dim", () => {
        const { out, reporter } = capture({ stdout: true, stderr: true });
        reporter.warn("css", "careful");
        reporter.info("build", "working");
        const text = out.join("");
        expect(text).toContain("\u001b[33m!\u001b[0m");
        expect(text).toContain("\u001b[33mcareful\u001b[0m");
        expect(text).toContain("\u001b[2mworking\u001b[0m");
    });

    it("colours each stream on its own", () => {
        const { out, err, reporter } = capture({ stdout: true, stderr: false });
        reporter.success("css", "a");
        reporter.failure("css", "b");
        expect(out.join("")).toContain("\u001b[");
        expect(err.join("")).not.toContain("\u001b");
        expect(reporter.colorStderr).toBe(false);
    });

    it("paints a step-less error red", () => {
        const { err, reporter } = capture({ stdout: true, stderr: true });
        reporter.error("opdk: boom");
        expect(err.join("")).toBe(`\u001b[31m✗${RESET} \u001b[31mopdk: boom${RESET}\n`);
    });
});

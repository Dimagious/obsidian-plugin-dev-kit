import { describe, expect, it, vi } from "vitest";
import { createFixtureFunctions, FIXTURE_TIMEOUT_MARGIN_MS, sessionFixtureTimeout, type FixtureTestInfo, type RecordingOptions } from "./fixtures.js";
import { resolveOptions } from "./options.js";
import type { ObsidianSession, SessionContext } from "./session.js";

function resolved(extra: Record<string, unknown> = {}) {
    return resolveOptions({ seedVault: "v", ...extra }, { cwd: "/plugin", env: {} });
}

interface Setup {
    session: ObsidianSession;
    teardown: ReturnType<typeof vi.fn<(outcome?: { failed: boolean }) => Promise<void>>>;
    start: ReturnType<typeof vi.fn<(context: SessionContext) => Promise<ObsidianSession>>>;
    sweep: ReturnType<typeof vi.fn<(hours: number | false) => void>>;
    testInfo: FixtureTestInfo;
}

function setup(extra: Partial<FixtureTestInfo> = {}): Setup {
    const teardown = vi.fn<(outcome?: { failed: boolean }) => Promise<void>>(() => Promise.resolve());
    // The fixture bodies only pass the session through; none of its members are read here.
    const session = { teardown } as unknown as ObsidianSession;
    const start = vi.fn<(context: SessionContext) => Promise<ObsidianSession>>(() => Promise.resolve(session));
    const sweep = vi.fn<(hours: number | false) => void>();
    const testInfo: FixtureTestInfo = {
        title: "opens settings",
        annotations: [],
        attachments: [],
        retry: 0,
        status: "passed",
        expectedStatus: "passed",
        outputPath: (...segments) => ["/results", ...segments].join("/"),
        ...extra,
    };
    return { session, teardown, start, sweep, testInfo };
}

describe("sessionFixtureTimeout", () => {
    it("is launch + ready + trace + 2 * close + the margin, so the kit's budgets always fire before Playwright's", () => {
        expect(sessionFixtureTimeout({ launch: 45_000, ready: 30_000, close: 5_000, trace: 60_000 })).toBe(
            145_000 + FIXTURE_TIMEOUT_MARGIN_MS,
        );
    });

    it("is longer than Playwright's default 60 s test timeout with the default budgets", () => {
        expect(sessionFixtureTimeout()).toBeGreaterThan(60_000);
    });

    it("follows the configured timeouts", () => {
        expect(sessionFixtureTimeout({ launch: 100, ready: 200, close: 300, trace: 400 })).toBe(1_300 + FIXTURE_TIMEOUT_MARGIN_MS);
    });
});

describe("createFixtureFunctions: timeout", () => {
    it("exposes the timeout computed from the resolved options", () => {
        const s = setup();
        const fns = createFixtureFunctions(resolved({ timeouts: { launch: 10_000, ready: 20_000, close: 1_000, trace: 2_000 } }), s);
        expect(fns.sessionTimeoutMs).toBe(34_000 + FIXTURE_TIMEOUT_MARGIN_MS);
    });
});

describe("createFixtureFunctions: sweep", () => {
    it("sweeps with the configured age, then hands control to the tests", async () => {
        const s = setup();
        const use = vi.fn(() => {
            expect(s.sweep).toHaveBeenCalledWith(5);
            return Promise.resolve();
        });
        await createFixtureFunctions(resolved({ sweepAfterHours: 5 }), s).sweep({}, use);
        expect(use).toHaveBeenCalledWith(undefined);
    });

    it("passes the default age and `false` through", async () => {
        const s = setup();
        await createFixtureFunctions(resolved(), s).sweep({}, () => Promise.resolve());
        await createFixtureFunctions(resolved({ sweepAfterHours: false }), s).sweep({}, () => Promise.resolve());
        expect(s.sweep.mock.calls).toEqual([[2], [false]]);
    });
});

describe("createFixtureFunctions: session", () => {
    it("starts the session with the test title as label, gives it to the test and tears it down after", async () => {
        const s = setup();
        const order: string[] = [];
        s.teardown.mockImplementation(() => {
            order.push("teardown");
            return Promise.resolve();
        });
        await createFixtureFunctions(resolved(), s).session({}, (value) => {
            order.push("use");
            expect(value).toBe(s.session);
            return Promise.resolve();
        }, s.testInfo);
        expect(s.start.mock.calls[0]?.[0].label).toBe("opens settings");
        expect(order).toEqual(["use", "teardown"]);
    });

    it("hands the test's seed to the session, checked", async () => {
        const s = setup();
        const seed = { files: { "Notes/a.md": "# a" }, config: { propertiesInDocument: "hidden" } };
        await createFixtureFunctions(resolved(), s).session({ seed }, () => Promise.resolve(), s.testInfo);
        expect(s.start.mock.calls[0]?.[0].seed).toEqual(seed);
        await createFixtureFunctions(resolved(), s).session({}, () => Promise.resolve(), s.testInfo);
        expect(s.start.mock.calls[1]?.[0].seed).toEqual({});
    });

    it("fails on a bad seed before any Obsidian is started", async () => {
        const s = setup();
        await expect(
            createFixtureFunctions(resolved(), s).session({ seed: { files: { "../x.md": "x" } } }, () => Promise.resolve(), s.testInfo),
        ).rejects.toThrow(/seed: the path "\.\.\/x\.md" leaves the vault/);
        expect(s.start).not.toHaveBeenCalled();
    });

    it("refuses a seed data.json for a plugin the data option already writes, before any Obsidian is started", async () => {
        const s = setup();
        const seed = { files: { ".obsidian/plugins/my-plugin/data.json": "{}" } };
        await expect(
            createFixtureFunctions(resolved({ data: { "my-plugin": { a: 1 } } }), s).session({ seed }, () => Promise.resolve(), s.testInfo),
        ).rejects.toThrow(/writes for "my-plugin"/);
        expect(s.start).not.toHaveBeenCalled();
    });

    it("turns the session's annotations into report annotations", async () => {
        const s = setup();
        s.start.mockImplementation((context) => {
            context.annotate("obsidian-version", "1.14.5");
            context.annotate("launch-mode", "electron");
            return Promise.resolve(s.session);
        });
        await createFixtureFunctions(resolved(), s).session({}, () => Promise.resolve(), s.testInfo);
        expect(s.testInfo.annotations).toEqual([
            { type: "obsidian-version", description: "1.14.5" },
            { type: "launch-mode", description: "electron" },
        ]);
    });

    it("tears down when the test body rejects, and the body's error propagates", async () => {
        const s = setup();
        const bodyError = new Error("assertion failed");
        await expect(
            createFixtureFunctions(resolved(), s).session({}, () => Promise.reject(bodyError), s.testInfo),
        ).rejects.toBe(bodyError);
        expect(s.teardown).toHaveBeenCalledTimes(1);
    });

    it("fails the test when teardown rejects", async () => {
        const s = setup();
        s.teardown.mockRejectedValue(new Error("Could not remove /tmp/x after retries"));
        await expect(createFixtureFunctions(resolved(), s).session({}, () => Promise.resolve(), s.testInfo)).rejects.toThrow(
            "Could not remove /tmp/x after retries",
        );
    });

    it("reports both errors when the body and the teardown fail", async () => {
        const s = setup();
        s.teardown.mockRejectedValue(new Error("cleanup broke"));
        const error = await createFixtureFunctions(resolved(), s)
            .session({}, () => Promise.reject(new Error("test broke")), s.testInfo)
            .then(
                () => undefined,
                (caught: unknown) => caught,
            );
        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).message).toContain("test: test broke");
        expect((error as AggregateError).message).toContain("cleanup: cleanup broke");
        expect((error as AggregateError).errors.map((e: unknown) => (e as Error).message)).toEqual(["test broke", "cleanup broke"]);
    });

    it("does not call teardown or the test when the session fails to start (startSession cleans up after itself)", async () => {
        const s = setup();
        s.start.mockRejectedValue(new Error("launch failed"));
        const use = vi.fn(() => Promise.resolve());
        await expect(createFixtureFunctions(resolved(), s).session({}, use, s.testInfo)).rejects.toThrow("launch failed");
        expect(use).not.toHaveBeenCalled();
        expect(s.teardown).not.toHaveBeenCalled();
    });
});

describe("createFixtureFunctions: artifacts and outcome", () => {
    async function runWith(extra: Partial<FixtureTestInfo>, recording: RecordingOptions = {}): Promise<Setup> {
        const s = setup(extra);
        await createFixtureFunctions(resolved(), s).session(recording, () => Promise.resolve(), s.testInfo);
        return s;
    }

    it("hands the session the trace and video options the fixture received, the retry and the output folder", async () => {
        const s = await runWith(
            { retry: 1 },
            { trace: { mode: "on", sources: false }, video: { mode: "retain-on-failure", size: { width: 640, height: 480 } } },
        );
        const plan = s.start.mock.calls[0]?.[0].artifacts;
        expect(plan?.trace).toEqual({ mode: "on", screenshots: true, snapshots: true, sources: false });
        expect(plan?.video).toEqual({ mode: "retain-on-failure", size: { width: 640, height: 480 } });
        expect(plan?.retry).toBe(1);
        expect(plan?.outputPath("obsidian-trace.zip")).toBe("/results/obsidian-trace.zip");
    });

    it("attaches files to the report", async () => {
        const s = await runWith({});
        s.start.mock.calls[0]?.[0].artifacts?.attach("trace", "/results/obsidian-trace.zip", "application/zip");
        expect(s.testInfo.attachments).toEqual([{ name: "trace", path: "/results/obsidian-trace.zip", contentType: "application/zip" }]);
    });

    it("records nothing when neither option is set", async () => {
        const s = await runWith({});
        const plan = s.start.mock.calls[0]?.[0].artifacts;
        expect([plan?.trace.mode, plan?.video.mode]).toEqual(["off", "off"]);
    });

    it("uses the values it is given, which is how a test.use({ trace, video }) in a spec reaches the session", async () => {
        const s = await runWith({}, { trace: "retain-on-failure", video: "on" });
        const plan = s.start.mock.calls[0]?.[0].artifacts;
        expect([plan?.trace.mode, plan?.video.mode]).toEqual(["retain-on-failure", "on"]);
    });

    it("fails the start with the option named when the config holds an unknown mode", async () => {
        const s = setup();
        await expect(createFixtureFunctions(resolved(), s).session({ trace: "always" }, () => Promise.resolve(), s.testInfo)).rejects.toThrow("use.trace");
        expect(s.start).not.toHaveBeenCalled();
    });

    it("reports a passed test to the teardown", async () => {
        const s = await runWith({});
        expect(s.teardown).toHaveBeenCalledWith({ failed: false });
    });

    it.each(["failed", "timedOut", "interrupted"])("reports a test with status %s as failed", async (status) => {
        const s = await runWith({ status });
        expect(s.teardown).toHaveBeenCalledWith({ failed: true });
    });

    it("does not count an expected failure (test.fail) as failed", async () => {
        const s = await runWith({ status: "failed", expectedStatus: "failed" });
        expect(s.teardown).toHaveBeenCalledWith({ failed: false });
    });

    it("treats an unknown status as not failed", async () => {
        const s = await runWith({ status: undefined });
        expect(s.teardown).toHaveBeenCalledWith({ failed: false });
    });

    it("reports a body that throws as failed", async () => {
        const s = setup();
        await expect(createFixtureFunctions(resolved(), s).session({}, () => Promise.reject(new Error("x")), s.testInfo)).rejects.toThrow("x");
        expect(s.teardown).toHaveBeenCalledWith({ failed: true });
    });
});

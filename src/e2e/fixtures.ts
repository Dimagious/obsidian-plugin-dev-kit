import { parseTraceSetting, parseVideoSetting } from "./artifacts.js";
import { DEFAULT_TIMEOUTS, type ResolvedOptions } from "./options.js";
import { resolveSeed } from "./seed.js";
import type { ObsidianSession, SessionContext } from "./session.js";

/** The side effects the fixture bodies use, injectable so their control flow can be tested without Playwright. */
export interface FixtureDeps {
    /** Starts a session for one test (see `startSession`). */
    readonly start: (context: SessionContext) => Promise<ObsidianSession>;
    /** Sweeps old temp folders when a worker starts (see `sweepAtWorkerStart`). */
    readonly sweep: (olderThanHours: number | false) => void;
}

/** The part of Playwright's `TestInfo` the session fixture uses. */
export interface FixtureTestInfo {
    readonly title: string;
    readonly annotations: { type: string; description?: string }[];
    readonly attachments: { name: string; contentType: string; path?: string }[];
    /** 0 for the first run of the test. */
    readonly retry: number;
    /** Set once the test body has finished; `expectedStatus` differs from it when the test failed. */
    readonly status?: string | undefined;
    readonly expectedStatus: string;
    readonly outputPath: (...segments: string[]) => string;
}

/**
 * Playwright's own `trace` and `video` option fixtures: the project's `use` with any `test.use(...)` of the spec file
 * or describe block applied on top. They decide what is recorded for the Obsidian window.
 */
export interface RecordingOptions {
    readonly trace?: unknown;
    readonly video?: unknown;
    /** The `seed` option of the test (`test.use({ seed })`); checked before anything is created. */
    readonly seed?: unknown;
}

/**
 * Time on top of `launch + ready + trace + 2 * close` that the session fixture may take: the process-tree kill (up to two
 * 3 s polls, about 6 s), folder removal with retries (about 1 s per folder, two folders) and slack.
 */
export const FIXTURE_TIMEOUT_MARGIN_MS = 20_000;

/**
 * The fixture's own time limit. Setup and teardown of a fixture share this one slot, and by default it is the test
 * timeout (60 s). The kit's budgets (launch 45 s + ready 30 s) are longer than that, so without a limit of its own
 * Playwright could abandon the setup while it was still waiting for Obsidian, and nothing would run the cleanup.
 * With a hung Obsidian the teardown can spend `trace` once (stopping the trace) and `close` twice (closing the app
 * and finishing the video). The kit's own timeouts therefore always fire first, `startSession`
 * tears down what it created, and the test fails with the kit's message.
 */
export function sessionFixtureTimeout(timeouts: ResolvedOptions["timeouts"] = DEFAULT_TIMEOUTS): number {
    return timeouts.launch + timeouts.ready + timeouts.trace + 2 * timeouts.close + FIXTURE_TIMEOUT_MARGIN_MS;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The bodies of the fixtures `createObsidianTest` registers, as plain functions: the worker-scoped sweep and the
 * per-test session. `session` always tears the session down, also when the test body throws, and a failing teardown
 * fails the test (it is never swallowed; when both fail the error carries both).
 */
export function createFixtureFunctions(
    options: ResolvedOptions,
    deps: FixtureDeps,
): {
    sweep: (args: object, use: (value: undefined) => Promise<void>) => Promise<void>;
    session: (args: RecordingOptions, use: (value: ObsidianSession) => Promise<void>, testInfo: FixtureTestInfo) => Promise<void>;
    sessionTimeoutMs: number;
} {
    return {
        sweep: async (_args, use) => {
            deps.sweep(options.sweepAfterHours);
            await use(undefined);
        },
        session: async ({ trace, video, seed }, use, testInfo) => {
            const resolvedSeed = resolveSeed(seed);
            const session = await deps.start({
                label: testInfo.title,
                seed: resolvedSeed,
                annotate: (type, description) => {
                    testInfo.annotations.push({ type, description });
                },
                artifacts: {
                    trace: parseTraceSetting(trace),
                    video: parseVideoSetting(video),
                    retry: testInfo.retry,
                    outputPath: (name) => testInfo.outputPath(name),
                    attach: (name, file, contentType) => {
                        testInfo.attachments.push({ name, path: file, contentType });
                    },
                },
            });
            try {
                await use(session);
            } catch (bodyError) {
                // Tear down anyway. If that fails too, report both: the cleanup failure must not hide why the test failed.
                await session.teardown({ failed: true }).catch((cleanupError: unknown) => {
                    throw new AggregateError(
                        [bodyError, cleanupError],
                        `The test failed and its cleanup failed too.\n- test: ${describe(bodyError)}\n- cleanup: ${describe(cleanupError)}`,
                    );
                });
                throw bodyError;
            }
            // After a normal return the body's result is on `testInfo`: a failed assertion or a timeout does not make
            // `use` throw, it only sets the status.
            await session.teardown({ failed: testInfo.status !== undefined && testInfo.status !== testInfo.expectedStatus });
        },
        sessionTimeoutMs: sessionFixtureTimeout(options.timeouts),
    };
}

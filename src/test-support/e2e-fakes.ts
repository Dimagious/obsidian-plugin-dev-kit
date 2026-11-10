import type { CDPSession, ElectronApplication, Page } from "@playwright/test";
import { readinessState, readRunningVersion } from "../e2e/page-scripts.js";
import type { ProcessIo } from "../e2e/process-tree.js";

/** How the fake Obsidian behaves; every field defaults to a healthy run. */
export interface FakeObsidianBehavior {
    pid?: number | undefined;
    /** What `ipcRenderer.sendSync("version")` returns; `null` is "could not read". */
    version?: string | null;
    failLaunch?: boolean;
    failInitScript?: boolean;
    failFirstWindow?: boolean;
    /** The readiness wait times out; the diagnostics show these plugins missing (not started) or loading (inside onload). */
    notReady?: { missing: string[]; loading?: string[]; trustDialogVisible?: boolean };
    /** Reading the running version throws (for example the window closed). */
    versionThrows?: boolean;
    /** `app.close()` never resolves (Obsidian hanging on quit). */
    hangOnClose?: boolean;
    /** `app.process()` throws. */
    processThrows?: boolean;
    /** Like Playwright 1.65: once `close()` ran, `process()` throws (the object is disposed). */
    processGoneAfterClose?: boolean;
    /** `app.close()` rejects. */
    closeRejects?: boolean;
    /** The process tree ignores SIGTERM. */
    ignoreSigterm?: boolean;
    /** The process tree ignores every signal. */
    immortal?: boolean;
    /** `context().tracing.start()` rejects. */
    tracingStartFails?: boolean;
    /** `context().tracing.stop()` rejects. */
    tracingStopFails?: boolean;
    /** `context().tracing.stop()` never resolves. */
    tracingStopHangs?: boolean;
    /** `context().tracing.stop()` resolves after this many milliseconds. */
    tracingStopDelayMs?: number;
    /** What `video.path()` returns; unset means the window has no video (`win.video()` is null). */
    videoPath?: string;
    /** `video.path()` never resolves. */
    videoPathHangs?: boolean;
}

export interface FakeObsidian {
    readonly app: ElectronApplication;
    readonly page: Page;
    readonly io: ProcessIo;
    /** What the fake's `spawnSync` was called with, as `command arg arg`. */
    readonly spawned: string[];
    /** Everything that happened, in order, as short strings. */
    readonly calls: string[];
    readonly signals: { pid: number; signal: NodeJS.Signals | 0 }[];
    readonly initScripts: unknown[];
    launchOptions: unknown;
    readonly tracingStarts: unknown[];
    /** The argument of each `tracing.stop()` call (`undefined` when it was called without options). */
    readonly tracingStops: unknown[];
    readonly dialogHandlers: ((dialog: { dismiss(): Promise<void> }) => void)[];
}

/**
 * A stand-in for `_electron.launch` and the objects it returns. Only what the session touches exists, so one
 * `as unknown as` per object is the whole cast surface in the tests.
 */
export function createFakeObsidian(behavior: FakeObsidianBehavior = {}): FakeObsidian & {
    launch: (options: unknown) => Promise<ElectronApplication>;
} {
    const pid = "pid" in behavior ? behavior.pid : 4242;
    const calls: string[] = [];
    const signals: { pid: number; signal: NodeJS.Signals | 0 }[] = [];
    const initScripts: unknown[] = [];
    const spawned: string[] = [];
    const tracingStarts: unknown[] = [];
    const tracingStops: unknown[] = [];
    const dialogHandlers: ((dialog: { dismiss(): Promise<void> }) => void)[] = [];
    let alive = true;

    const io: ProcessIo = {
        platform: "darwin",
        sleep: () => Promise.resolve(),
        kill: (target, signal) => {
            signals.push({ pid: target, signal });
            if (signal === 0) {
                if (!alive) {
                    throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
                }
                return;
            }
            if (behavior.immortal === true || (signal === "SIGTERM" && behavior.ignoreSigterm === true)) {
                return;
            }
            alive = false;
        },
        // The Windows tree kill: `taskkill` ends the whole tree unless the fake is immortal.
        spawnSync: (command, args) => {
            spawned.push([command, ...args].join(" "));
            if (behavior.immortal !== true) {
                alive = false;
            }
            return { status: 0, stderr: "" };
        },
    };

    const page = {
        on: (event: string, handler: (dialog: { dismiss(): Promise<void> }) => void) => {
            calls.push(`page.on:${event}`);
            dialogHandlers.push(handler);
        },
        waitForFunction: (_fn: unknown, ids: unknown, options: unknown) => {
            calls.push(`waitForFunction:${JSON.stringify(ids)}:${JSON.stringify(options)}`);
            return behavior.notReady === undefined ? Promise.resolve() : Promise.reject(new Error("Timeout 30000ms exceeded."));
        },
        // Dispatches on the identity of the page function the session passes, not on its name: a rename or a
        // swapped-in function is caught here instead of silently answering the wrong question.
        evaluate: (fn: unknown) => {
            if (fn === readRunningVersion) {
                return behavior.versionThrows === true
                    ? Promise.reject(new Error("Target page, context or browser has been closed"))
                    : Promise.resolve(behavior.version === undefined ? "1.14.5" : behavior.version);
            }
            if (fn === readinessState) {
                return Promise.resolve({
                    hasApp: true,
                    layoutReady: true,
                    missing: behavior.notReady?.missing ?? [],
                    loading: behavior.notReady?.loading ?? [],
                });
            }
            throw new Error("createFakeObsidian: page.evaluate was called with a function the fake does not know. Teach the fake about it.");
        },
        video: () =>
            behavior.videoPath === undefined
                ? null
                : {
                      path: () =>
                          behavior.videoPathHangs === true ? new Promise<string>(() => undefined) : Promise.resolve(behavior.videoPath ?? ""),
                  },
        getByRole: () => ({ isVisible: () => Promise.resolve(behavior.notReady?.trustDialogVisible === true) }),
    };

    const app = {
        context: () => ({
            tracing: {
                start: (options: unknown) => {
                    calls.push("tracing.start");
                    tracingStarts.push(options);
                    return behavior.tracingStartFails === true ? Promise.reject(new Error("tracing start failed")) : Promise.resolve();
                },
                stop: (options: unknown) => {
                    calls.push("tracing.stop");
                    tracingStops.push(options);
                    if (behavior.tracingStopHangs === true) {
                        return new Promise<void>(() => undefined);
                    }
                    if (behavior.tracingStopDelayMs !== undefined) {
                        return new Promise<void>((resolve) => setTimeout(resolve, behavior.tracingStopDelayMs));
                    }
                    return behavior.tracingStopFails === true ? Promise.reject(new Error("tracing stop failed")) : Promise.resolve();
                },
            },
            addInitScript: (script: unknown, arg: unknown) => {
                calls.push("addInitScript");
                initScripts.push({ script, arg });
                return behavior.failInitScript === true ? Promise.reject(new Error("init script failed")) : Promise.resolve();
            },
        }),
        firstWindow: () => {
            calls.push("firstWindow");
            return behavior.failFirstWindow === true ? Promise.reject(new Error("no window")) : Promise.resolve(page);
        },
        evaluate: (_fn: unknown, arg: unknown) => {
            calls.push(`app.evaluate:${JSON.stringify(arg)}`);
            return Promise.resolve();
        },
        process: () => {
            if (behavior.processThrows === true || (behavior.processGoneAfterClose === true && calls.includes("app.close"))) {
                throw new Error("process() is gone");
            }
            return { pid };
        },
        close: () => {
            calls.push("app.close");
            if (behavior.closeRejects === true) {
                return Promise.reject(new Error("Target closed"));
            }
            return behavior.hangOnClose === true ? new Promise<void>(() => undefined) : Promise.resolve();
        },
    };

    const fake: FakeObsidian & { launch: (options: unknown) => Promise<ElectronApplication> } = {
        app: app as unknown as ElectronApplication,
        page: page as unknown as Page,
        io,
        spawned,
        calls,
        signals,
        initScripts,
        launchOptions: undefined,
        tracingStarts,
        tracingStops,
        dialogHandlers,
        launch: (options) => {
            calls.push("launch");
            fake.launchOptions = options;
            return behavior.failLaunch === true ? Promise.reject(new Error("launch failed")) : Promise.resolve(fake.app);
        },
    };
    return fake;
}

type Handler = (arg: unknown, options?: unknown) => unknown;

export interface FakeHelperWindow {
    readonly win: Page;
    /** Everything that happened, in order, as short strings. */
    readonly log: string[];
    /** The CDP commands sent, in order. */
    readonly cdp: { method: string; params: unknown }[];
    /** Answers `win.evaluate(fn, arg)` for exactly this page function. A throw becomes a rejection. */
    onEvaluate(fn: unknown, handler: Handler): void;
    /** Answers `win.waitForFunction(fn, arg, options)` for exactly this page function. */
    onWait(fn: unknown, handler: Handler): void;
    /** Makes `waitFor` on this selector reject, as when the element never appears; with `state`, only for that state. */
    failWaitFor(selector: string, state?: string): void;
    /** What `win.isClosed()` answers. */
    closed: boolean;
    /** How many windows the app has (`win.context().pages()`); 1 unless a test opens a popout. */
    windows: number;
    /**
     * The waits that were started without an explicit timeout (`waitFor`, `click`, `fill`, `pressSequentially`,
     * `waitForFunction`), as short strings. Playwright's defaults for them reach the test timeout or never end, so a
     * helper must always give one; a test that runs a helper can assert this stays empty.
     */
    readonly unbounded: string[];
    /** The explicit timeout each wait started with, in order, as `what` (method and selector) and `timeout`. */
    readonly timeouts: { what: string; timeout: number }[];
}

/**
 * A stand-in for the Obsidian window as the `obsidian` helpers use it. Like `createFakeObsidian`, it answers
 * `evaluate` and `waitForFunction` by the identity of the page function, so a helper that asks the wrong question
 * (or a renamed function) fails here instead of silently getting an answer.
 */
export function createFakeHelperWindow(): FakeHelperWindow {
    const log: string[] = [];
    const cdp: { method: string; params: unknown }[] = [];
    const evaluators = new Map<unknown, Handler>();
    const waiters = new Map<unknown, Handler>();
    const failing = new Set<string>();
    const unbounded: string[] = [];
    const timeouts: { what: string; timeout: number }[] = [];
    const fake: FakeHelperWindow = {
        win: undefined as unknown as Page,
        log,
        cdp,
        onEvaluate: (fn, handler) => {
            evaluators.set(fn, handler);
        },
        onWait: (fn, handler) => {
            waiters.set(fn, handler);
        },
        failWaitFor: (selector, state) => {
            failing.add(state === undefined ? selector : `${selector}|${state}`);
        },
        closed: false,
        windows: 1,
        unbounded,
        timeouts,
    };
    const checkTimeout = (what: string, options: { timeout?: number } | undefined): void => {
        if (typeof options?.timeout !== "number" || options.timeout <= 0) {
            unbounded.push(what);
        } else {
            timeouts.push({ what, timeout: options.timeout });
        }
    };
    const answer = (table: Map<unknown, Handler>, kind: string, fn: unknown, arg: unknown, options?: unknown): Promise<unknown> => {
        if (kind === "waitForFunction") {
            checkTimeout(`waitForFunction:${(fn as { name?: string }).name ?? "?"}`, options as { timeout?: number } | undefined);
        }
        const handler = table.get(fn);
        if (handler === undefined) {
            return Promise.reject(new Error(`createFakeHelperWindow: ${kind} was called with a page function the fake does not know. Teach the fake about it.`));
        }
        try {
            return Promise.resolve(handler(arg, options));
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
    };
    const locator = (selector: string, options?: { hasText?: string }): object => {
        const described = options?.hasText === undefined ? selector : `${selector}[hasText=${options.hasText}]`;
        log.push(`locator:${described}`);
        const self = {
            first: () => self,
            waitFor: (o?: { state?: string; timeout?: number }) => {
                checkTimeout(`waitFor:${described}`, o);
                const state = o?.state ?? "visible";
                log.push(`waitFor:${described}:${state}`);
                return failing.has(selector) || failing.has(`${selector}|${state}`) ? Promise.reject(new Error(`Timeout waiting for ${selector}`)) : Promise.resolve();
            },
            fill: (text: string, o?: { timeout?: number }) => {
                checkTimeout(`fill:${described}`, o);
                log.push(`fill:${described}:${text}`);
                return Promise.resolve();
            },
            click: (o?: { timeout?: number }) => {
                checkTimeout(`click:${described}`, o);
                log.push(`click:${described}`);
                return Promise.resolve();
            },
            pressSequentially: (text: string, o?: { delay?: number; timeout?: number }) => {
                checkTimeout(`pressSequentially:${described}`, o);
                log.push(`pressSequentially:${described}:${text}:${String(o?.delay)}`);
                return Promise.resolve();
            },
        };
        return self;
    };
    const session = {
        send: (method: string, params?: unknown) => {
            cdp.push({ method, params });
            return Promise.resolve();
        },
        detach: () => {
            log.push("cdp.detach");
            return Promise.resolve();
        },
    };
    const page = {
        evaluate: (fn: unknown, arg?: unknown) => answer(evaluators, "evaluate", fn, arg),
        waitForFunction: (fn: unknown, arg?: unknown, options?: unknown) => answer(waiters, "waitForFunction", fn, arg, options),
        locator,
        keyboard: {
            press: (keys: string) => {
                log.push(`press:${keys}`);
                return Promise.resolve();
            },
        },
        context: () => ({
            pages: () => Array.from({ length: fake.windows }, () => page),
            newCDPSession: () => {
                log.push("newCDPSession");
                return Promise.resolve(session as unknown as CDPSession);
            },
        }),
        isClosed: () => fake.closed,
    };
    return Object.assign(fake, { win: page as unknown as Page });
}

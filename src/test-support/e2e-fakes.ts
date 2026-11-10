import type { ElectronApplication, Page } from "@playwright/test";
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

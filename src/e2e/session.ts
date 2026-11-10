import fs from "node:fs";
import path from "node:path";
import type { _electron, ElectronApplication, Page, Video } from "@playwright/test";
import { shouldKeep, shouldRecord, type TraceSettings, type VideoSettings } from "./artifacts.js";
import { CleanupStack, createTempDir, removeDir } from "./cleanup.js";
import { assertElectronInstalled, type ElectronProbe } from "./electron-binary.js";
import { findObsidianAsar } from "./obsidian-path.js";
import type { ResolvedOptions } from "./options.js";
import { applyTrust, readRunningVersion, resizeMainWindow } from "./page-scripts.js";
import {
    assertBuildFresh,
    assertDataIdsInstalled,
    assertUniqueIds,
    installPlugin,
    readPluginSource,
    writeCommunityPlugins,
    writePluginData,
    type PluginSource,
} from "./plugins.js";
import { terminateTree, type ProcessIo } from "./process-tree.js";
import { waitForReady } from "./readiness.js";
import {
    copySeedVault,
    createVaultHandle,
    generateVaultId,
    trustKey,
    writeAppDefaults,
    writeUserData,
    type VaultHandle,
} from "./vault.js";
import { compareObsidianVersions } from "./version.js";

/** The trace is written under this name in the test's output folder. */
export const TRACE_FILE = "obsidian-trace.zip";

export type ElectronLaunchOptions = NonNullable<Parameters<typeof _electron.launch>[0]>;
export type ElectronLauncher = (options: ElectronLaunchOptions) => Promise<ElectronApplication>;

/** Everything with a side effect on the machine, injectable so the cleanup paths can be tested with fakes. */
export interface SessionDeps {
    readonly launch: ElectronLauncher;
    readonly io: ProcessIo;
    /** Finds the plugin's `electron` package and its downloaded binary. */
    readonly electron: ElectronProbe;
    readonly env: Readonly<Record<string, string | undefined>>;
    /** Where temp folders go. Default `os.tmpdir()`. */
    readonly tmpRoot?: string;
    readonly now?: () => number;
}

/** What the session needs to keep a trace and a video of the Obsidian window; see `artifacts.ts`. */
export interface ArtifactPlan {
    readonly trace: TraceSettings;
    readonly video: VideoSettings;
    /** 0 for the first run, 1 for the first retry. */
    readonly retry: number;
    /** A path inside the test's output folder (`test-results`), which Playwright cleans. */
    readonly outputPath: (name: string) => string;
    /** Adds a file to the test report. */
    readonly attach: (name: string, path: string, contentType: string) => void;
}

export interface SessionContext {
    /** Goes into the temp folder names; the test title. */
    readonly label: string;
    /** Adds a note to the test report. */
    readonly annotate: (type: string, description: string) => void;
    /** Absent: no trace and no video. */
    readonly artifacts?: ArtifactPlan;
}

/** How the test ended; decides which recordings are kept. */
export interface SessionOutcome {
    readonly failed: boolean;
}

/** A running Obsidian with its throwaway vault. `teardown` must always be called. */
export interface ObsidianSession {
    readonly app: ElectronApplication;
    readonly win: Page;
    readonly vault: VaultHandle;
    /** Stops the recordings, closes Obsidian and removes the folders. `outcome` defaults to a passed test. */
    teardown(outcome?: SessionOutcome): Promise<void>;
}

/** The environment Obsidian starts with: ours minus the variables that break it or aim it at the wrong vault. */
export function buildLaunchEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        // ELECTRON_RUN_AS_NODE forces the local electron binary to run as plain Node, which rejects Chromium flags
        // such as the debugging port Playwright passes. VAULT_PLUGIN is the dev-vault of `opdk build --vault`; it has
        // no business in a test and must never reach a process that writes files.
        if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE" && key !== "VAULT_PLUGIN") {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Checks everything that can be checked without creating anything: the Obsidian install, the build output of every
 * plugin, the `data` ids. A problem here leaves nothing behind.
 */
export function prepareSession(
    options: ResolvedOptions,
    deps: Pick<SessionDeps, "env">,
    platform: NodeJS.Platform = process.platform,
): { asar: string; sources: PluginSource[] } {
    const asar = findObsidianAsar({
        option: options.obsidianPath,
        env: deps.env,
        platform,
        exists: fs.existsSync,
        cwd: options.cwd,
    });
    const sources = options.pluginDirs.map((dir) => readPluginSource(dir));
    assertUniqueIds(sources);
    assertDataIdsInstalled(options.data, sources);
    for (const source of sources) {
        if (options.staleCheckDirs.includes(source.dir)) {
            assertBuildFresh(source);
        }
    }
    return { asar, sources };
}

/**
 * Starts Obsidian on a fresh copy of the seed vault. If any step throws, everything created so far is torn down
 * before the error reaches the caller.
 */
export async function startSession(
    options: ResolvedOptions,
    deps: SessionDeps,
    context: SessionContext,
): Promise<ObsidianSession> {
    const { asar, sources } = prepareSession(options, deps);
    // Before any folder is created: a missing Electron binary would otherwise surface as a launch timeout.
    assertElectronInstalled(options.cwd, deps.electron);
    const stack = new CleanupStack();
    try {
        return await open(options, deps, context, asar, sources, stack);
    } catch (error) {
        try {
            await stack.run();
        } catch (cleanupError) {
            const reason = error instanceof Error ? error.message : String(error);
            const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
            throw new Error(`${reason}\n\n${cleanup}`, { cause: cleanupError });
        }
        throw error;
    }
}

async function open(
    options: ResolvedOptions,
    deps: SessionDeps,
    context: SessionContext,
    asar: string,
    sources: readonly PluginSource[],
    stack: CleanupStack,
): Promise<ObsidianSession> {
    const now = deps.now ?? Date.now;
    // A session that fails while starting never reaches `teardown(outcome)`; it has failed by definition.
    const outcome = { failed: true };
    const plan = context.artifacts;
    const videoDir = plan !== undefined && shouldRecord(plan.video.mode, plan.retry) ? plan.outputPath("video") : undefined;
    const vaultRoot = createTempDir("vault", context.label, deps.tmpRoot);
    stack.add(`remove ${vaultRoot}`, () => {
        removeDir(vaultRoot);
    });
    const userDataDir = createTempDir("userdata", "", deps.tmpRoot);
    stack.add(`remove ${userDataDir}`, () => {
        removeDir(userDataDir);
    });

    const vaultPath = path.join(vaultRoot, "vault");
    const vaultId = generateVaultId();
    copySeedVault(options.seedVault, vaultPath);
    writeAppDefaults(vaultPath);
    for (const source of sources) {
        installPlugin(vaultPath, source);
    }
    writeCommunityPlugins(
        vaultPath,
        sources.map((source) => source.id),
    );
    for (const [id, data] of Object.entries(options.data)) {
        writePluginData(vaultPath, id, data);
    }
    writeUserData({ userDataDir, vaultId, vaultPath, now: now() });

    // No `executablePath` on purpose: Playwright then resolves `electron` from `cwd` (the plugin's node_modules) and
    // injects its loader, which holds back the app's `ready` event until Playwright is attached. With an
    // `executablePath` the loader is skipped and the attachment can miss early events.
    const launchStartedAt = now();
    const app = await deps.launch({
        args: [asar, `--user-data-dir=${userDataDir}`, ...options.electronArgs],
        env: buildLaunchEnv(deps.env),
        cwd: options.cwd,
        timeout: options.timeouts.launch,
        // Playwright's `use.video` does not reach this window (see artifacts.ts), so the recording is asked for here.
        ...(videoDir === undefined ? {} : { recordVideo: { dir: videoDir, ...(plan?.video.size === undefined ? {} : { size: plan.video.size }) } }),
    });
    // Undo steps run newest first. Registration order is therefore: the video (finished after the close), the close,
    // the trace (stopped before the close). The video file only exists once the app has closed.
    const recorded: { video?: Video | null } = {};
    if (plan !== undefined && videoDir !== undefined) {
        stack.add("finish the video of the Obsidian window", () =>
            finishVideo(recorded.video, plan, outcome.failed, options.timeouts.close),
        );
    }
    // Registered before anything else touches `app`, so every later failure closes it. The pid is read right after
    // registering, not inside the step: once `app.close()` has run, Playwright disposes the object and
    // `app.process()` throws (seen in the first live run, Playwright 1.65). A pid that cannot be read is kept as an
    // error and reported after the close attempt.
    const processId: { pid?: number; error?: unknown } = {};
    stack.add("close Obsidian and its process tree", () => shutdown(app, processId, deps.io, options.timeouts.close));
    try {
        processId.pid = app.process().pid;
    } catch (error) {
        processId.error = error;
    }

    if (plan !== undefined && shouldRecord(plan.trace.mode, plan.retry)) {
        const { trace } = plan;
        // Before the readiness wait, so the startup is in the trace. A failure here is a failure of the start: the
        // stack closes the app.
        await app.context().tracing.start({
            screenshots: trace.screenshots,
            snapshots: trace.snapshots,
            sources: trace.sources,
            title: context.label,
        });
        stack.add("stop the trace of the Obsidian window", () => stopTrace(app, plan, outcome.failed, options.timeouts.trace));
    }

    // The vault id is the key Obsidian stores the trust flag under; the kit chose it when it wrote obsidian.json.
    // Set before the window's scripts run, so the trust dialog never appears (no dialog to find, click or wait for).
    await app.context().addInitScript(applyTrust, trustKey(vaultId));
    const win = await app.firstWindow();
    if (videoDir !== undefined) {
        recorded.video = win.video();
    }
    // Auto-dismiss native JS dialogs (alert/confirm/prompt): the playwright-electron teardown sometimes synthesises
    // a dialog-handle call that hangs without a handler. A failed dismiss only means the dialog is already gone.
    win.on("dialog", (dialog) => {
        dialog.dismiss().catch(() => undefined);
    });
    if (options.window !== undefined) {
        await app.evaluate(resizeMainWindow, options.window);
    }
    await waitForReady(
        win,
        sources.map((source) => source.id),
        options.timeouts.ready,
    );
    // The session fixture runs with its own timeout, so Playwright counts its time in a separate slot and the reported
    // test duration covers the test body only; this note carries the launch time.
    context.annotate("obsidian-launch-ms", String(now() - launchStartedAt));
    await checkVersion(win, options.expectedVersion, context);

    return {
        app,
        win,
        vault: createVaultHandle(vaultPath),
        teardown: (result) => {
            outcome.failed = result?.failed ?? false;
            return stack.run();
        },
    };
}

/** Reads the running version, records it in the report and fails when it is not the one the run asked for. */
async function checkVersion(win: Page, expected: string | null, context: SessionContext): Promise<void> {
    let running: string | null = null;
    let readError: string | undefined;
    try {
        running = await win.evaluate(readRunningVersion);
    } catch (error) {
        readError = error instanceof Error ? error.message : String(error);
    }
    context.annotate("obsidian-version", running ?? "unknown");
    context.annotate("launch-mode", "electron");
    if (expected === null) {
        return;
    }
    context.annotate("obsidian-expected-version", expected);
    const verdict = compareObsidianVersions(expected, running);
    if (verdict.status === "mismatch") {
        throw new Error(verdict.message);
    }
    if (verdict.status === "unknown") {
        throw new Error(
            `Cannot verify OBSIDIAN_VERSION=${expected}: ${verdict.message}${readError === undefined ? "" : ` (${readError})`}.`,
        );
    }
}

/** Rejects with `message` when `work` takes longer than `ms`; the work itself is left running. */
async function within<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new Error(message));
        }, ms);
    });
    try {
        return await Promise.race([work, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/** Stops the trace while the app is still open. The zip is written (and attached) only when the mode keeps it. */
async function stopTrace(app: ElectronApplication, plan: ArtifactPlan, failed: boolean, ms: number): Promise<void> {
    const keep = shouldKeep(plan.trace.mode, failed, plan.retry);
    const file = keep ? plan.outputPath(TRACE_FILE) : undefined;
    await within(
        app.context().tracing.stop(file === undefined ? undefined : { path: file }),
        ms,
        `Stopping the Obsidian trace took longer than ${String(ms)} ms (timeouts.trace). Obsidian is probably hung, or the test recorded a lot: raise timeouts.trace for a long traced test. The app is closed next.`,
    );
    if (file !== undefined) {
        plan.attach("trace", file, "application/zip");
    }
}

/** Runs after the app has closed: keeps the video as an attachment or deletes the file, per the mode. */
async function finishVideo(
    video: Video | null | undefined,
    plan: ArtifactPlan,
    failed: boolean,
    ms: number,
): Promise<void> {
    if (video === undefined || video === null) {
        // The window never opened (or recording did not start), so there is no file to keep or delete.
        return;
    }
    const file = await within(
        video.path(),
        ms,
        `Playwright did not finish the Obsidian video within ${String(ms)} ms. Look for a stray .webm in the test-results folder.`,
    );
    if (!shouldKeep(plan.video.mode, failed, plan.retry)) {
        fs.rmSync(file, { force: true });
        return;
    }
    if (!fs.existsSync(file)) {
        throw new Error(`The Obsidian video was expected at ${file} but is not there. The test result is not affected.`);
    }
    plan.attach("video", file, "video/webm");
}

async function shutdown(
    app: ElectronApplication,
    processId: { readonly pid?: number; readonly error?: unknown },
    io: ProcessIo,
    closeMs: number,
): Promise<void> {
    // Obsidian sometimes refuses to exit cleanly (a workspace-save prompt, or a listener that blocks `before-quit`)
    // and `app.close()` then never resolves. Race it against a timeout; what matters is that the process tree is
    // gone, and that is verified below, so a failing `close()` itself is not worth a failure.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, closeMs);
    });
    try {
        await Promise.race([app.close().catch(() => undefined), timeout]);
    } finally {
        clearTimeout(timer);
    }
    const { pid } = processId;
    if (pid === undefined) {
        const reason = processId.error === undefined ? "" : ` (${errorText(processId.error)})`;
        throw new Error(
            `Playwright gave no process id for Obsidian${reason}, so the process tree could not be checked. Look for stray Obsidian processes.`,
            { cause: processId.error },
        );
    }
    await terminateTree(pid, io);
}

function errorText(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return typeof error === "string" ? error : JSON.stringify(error);
}

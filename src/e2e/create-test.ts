import path from "node:path";
import {
    _electron,
    expect,
    test as base,
    type ElectronApplication,
    type Page,
    type PlaywrightTestArgs,
    type PlaywrightTestOptions,
    type PlaywrightWorkerArgs,
    type PlaywrightWorkerOptions,
    type TestType,
} from "@playwright/test";
import { sweepAtWorkerStart } from "./cleanup.js";
import { createElectronProbe } from "./electron-binary.js";
import { createDemo } from "./demo/create-demo.js";
import { defaultNameText } from "./demo/names.js";
import type { DemoHelpers } from "./demo/types.js";
import { createFixtureFunctions } from "./fixtures.js";
import { createHelpers, type HelperKit } from "./helpers/create-helpers.js";
import type { ObsidianHelpers } from "./helpers/types.js";
import type { VaultSeed } from "./seed.js";
import { gateSkipReason, isGateOpen } from "./gate.js";
import { resolveOptions, type ObsidianTestOptions } from "./options.js";
import { createProcessIo } from "./process-tree.js";
import { startSession, type ObsidianSession } from "./session.js";
import type { VaultHandle } from "./vault.js";

/** Fixtures every spec gets. */
export interface ObsidianFixtures {
    /** The Obsidian window, with the workspace laid out and every installed plugin loaded. */
    win: Page;
    /** The Electron application: `app.evaluate` runs in the main process. */
    app: ElectronApplication;
    /** The per-test copy of the seed vault. */
    vault: VaultHandle;
    /** Helpers for settings, commands, files, the editor, themes, mobile and fakes, bound to this window. */
    obsidian: ObsidianHelpers;
    /** Films and stills of the window with overlays, a clean UI, frozen time and themes; see `DemoHelpers`. Only a test that asks for it pays for it. */
    demo: DemoHelpers;
}

/** Options a spec sets with `test.use(...)`. */
export interface ObsidianTestUse {
    /** Files and `app.json` keys added to this test's vault before Obsidian starts; see `VaultSeed`. */
    seed: VaultSeed | undefined;
}

/** Internal: the one fixture the three above are views of, so setup and teardown happen in one place. */
interface InternalFixtures {
    opdkSession: ObsidianSession;
    /** The helpers of the window with their one CDP session, shared by `obsidian` and `demo`. */
    opdkHelpers: HelperKit;
}

interface InternalWorkerFixtures {
    opdkSweep: undefined;
}

/** What a spec can use. The internal fixtures are not part of the type, so a spec cannot ask for them by mistake. */
export type ObsidianTest = TestType<
    PlaywrightTestArgs & PlaywrightTestOptions & ObsidianFixtures & ObsidianTestUse,
    PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

export interface ObsidianTestKit {
    readonly test: ObsidianTest;
    readonly expect: typeof expect;
    /** Call at the top of a spec file: skips the file unless the env var `name` is "1". */
    readonly onlyWhen: (name: string) => void;
}

/**
 * Builds the Playwright `test` for a plugin: every test gets a fresh Obsidian on a fresh copy of the seed vault,
 * with the plugins installed and trusted. Options are checked here, so a typo fails when `fixtures.ts` is imported.
 */
export function createObsidianTest(options: ObsidianTestOptions): ObsidianTestKit {
    const resolved = resolveOptions(options, { cwd: process.cwd(), env: process.env });
    const functions = createFixtureFunctions(resolved, {
        start: (context) =>
            startSession(
                resolved,
                {
                    launch: (launchOptions) => _electron.launch(launchOptions),
                    io: createProcessIo(),
                    electron: createElectronProbe(),
                    env: process.env,
                },
                context,
            ),
        sweep: (hours) => {
            sweepAtWorkerStart(hours, console.warn);
        },
    });
    const extended = base.extend<InternalFixtures & ObsidianFixtures & ObsidianTestUse, InternalWorkerFixtures>({
        // Playwright reads the source text of each fixture function and insists that its first parameter is an object
        // destructuring pattern (it finds the fixtures a fixture depends on that way), so a function handed over by
        // reference, or with a plain parameter, is refused when the tests are listed. Hence the wrappers.
        // `box: true` keeps the internal fixtures out of the report's steps and error locations.
        opdkSweep: [
            // eslint-disable-next-line no-empty-pattern
            async ({}, use) => {
                await functions.sweep({}, use);
            },
            { scope: "worker", auto: true, box: true },
        ],
        // An option fixture: `test.use({ seed })` sets it per file or describe block.
        seed: [undefined, { option: true }],
        // Its own timeout: see `sessionFixtureTimeout`.
        opdkSession: [
            // `trace` and `video` are Playwright's option fixtures, so a `test.use({ trace, video })` in a spec counts.
            async ({ trace, video, seed }, use, testInfo) => {
                await functions.session({ trace, video, seed }, use, testInfo);
            },
            { box: true, timeout: functions.sessionTimeoutMs },
        ],
        win: async ({ opdkSession }, use) => {
            await use(opdkSession.win);
        },
        app: async ({ opdkSession }, use) => {
            await use(opdkSession.app);
        },
        vault: async ({ opdkSession }, use) => {
            await use(opdkSession.vault);
        },
        opdkHelpers: [
            async ({ win }, use) => {
                const kit = createHelpers(win, { readyTimeoutMs: resolved.timeouts.ready, timeouts: resolved.helperTimeouts });
                await use(kit);
                await kit.dispose();
            },
            { box: true },
        ],
        obsidian: async ({ opdkHelpers }, use) => {
            await use(opdkHelpers.helpers);
        },
        demo: async ({ win, opdkHelpers }, use, testInfo) => {
            const controller = createDemo({
                win,
                cdp: () => opdkHelpers.cdpSession(),
                deviceMetrics: opdkHelpers.deviceMetrics,
                setTheme: (themeOptions) => opdkHelpers.helpers.setTheme(themeOptions),
                collapseSidebars: () => opdkHelpers.helpers.collapseSidebars(),
                settle: () => opdkHelpers.helpers.settle(),
                options: resolved.demo,
                uiTimeoutMs: resolved.helperTimeouts.ui,
                seedVault: resolved.seedVault,
                seedVaultSource: resolved.seedVaultSource,
                cwd: resolved.cwd,
                testTitle: defaultNameText({ titlePath: testInfo.titlePath, project: testInfo.project.name, projectCount: testInfo.config.projects.length }),
                source: {
                    testId: testInfo.testId,
                    title: testInfo.titlePath.slice(1).join(" "),
                    file: path.relative(resolved.cwd, testInfo.file).split(path.sep).join("/"),
                },
                // Workers are children of the process that runs the invocation, so its pid tells the runs apart.
                runId: String(process.ppid),
            });
            await use(controller.demo);
            // After a normal return the outcome is on `testInfo`, as in the session fixture.
            controller.finish({ status: testInfo.status });
        },
    });
    // The one cast: `extend` returns a type that also lists the internal fixtures, and TestType is invariant in its
    // fixture arguments, so it cannot be narrowed by assignment. Nothing else changes: it is the same object.
    const test = extended as unknown as ObsidianTest;
    return {
        test,
        expect,
        onlyWhen: (name) => {
            test.skip(!isGateOpen(process.env, name), gateSkipReason(name));
        },
    };
}

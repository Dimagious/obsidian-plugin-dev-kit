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
import { createFixtureFunctions } from "./fixtures.js";
import { createHelpers } from "./helpers/create-helpers.js";
import type { ObsidianHelpers } from "./helpers/types.js";
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
}

/** Internal: the one fixture the three above are views of, so setup and teardown happen in one place. */
interface InternalFixtures {
    opdkSession: ObsidianSession;
}

interface InternalWorkerFixtures {
    opdkSweep: undefined;
}

/** What a spec can use. The internal fixtures are not part of the type, so a spec cannot ask for them by mistake. */
export type ObsidianTest = TestType<
    PlaywrightTestArgs & PlaywrightTestOptions & ObsidianFixtures,
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
    const extended = base.extend<InternalFixtures & ObsidianFixtures, InternalWorkerFixtures>({
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
        // Its own timeout: see `sessionFixtureTimeout`.
        opdkSession: [
            // `trace` and `video` are Playwright's option fixtures, so a `test.use({ trace, video })` in a spec counts.
            async ({ trace, video }, use, testInfo) => {
                await functions.session({ trace, video }, use, testInfo);
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
        obsidian: async ({ win }, use) => {
            const kit = createHelpers(win, { readyTimeoutMs: resolved.timeouts.ready, timeouts: resolved.helperTimeouts });
            await use(kit.helpers);
            await kit.dispose();
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

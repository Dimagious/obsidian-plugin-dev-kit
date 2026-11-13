import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeObsidian, type FakeObsidianBehavior } from "../test-support/e2e-fakes.js";
import { createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { testTmpRoot } from "../test-support/test-tmp.js";
import { listTempDirs, TEMP_PREFIX } from "./cleanup.js";
import { parseTraceSetting, parseVideoSetting } from "./artifacts.js";
import { resolveOptions, type ObsidianTestOptions, type ResolvedOptions } from "./options.js";
import { buildLaunchEnv, prepareSession, startSession, TRACE_FILE, type ArtifactPlan, type SessionDeps } from "./session.js";

let sandbox: string;
let tmpRoot: string;
let plugin: PluginFixture;
let seed: string;
let asar: string;

beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(testTmpRoot(), `${TEMP_PREFIX}test-`));
    tmpRoot = path.join(sandbox, "tmp");
    fs.mkdirSync(tmpRoot);
    seed = path.join(sandbox, "seed");
    fs.mkdirSync(path.join(seed, ".obsidian"), { recursive: true });
    fs.writeFileSync(path.join(seed, "Welcome.md"), "# hi");
    asar = path.join(sandbox, "app.asar");
    fs.writeFileSync(asar, "asar");
    plugin = createPluginFixture({ id: "my-plugin" });
    plugin.write("main.js", "//js");
});

afterEach(() => {
    vi.restoreAllMocks();
    plugin.cleanup();
    try {
        // Every test must leave the temp root empty (a test that expects a leftover removes it itself).
        expect(listTempDirs(tmpRoot)).toEqual([]);
    } finally {
        fs.rmSync(sandbox, { recursive: true, force: true });
    }
});

function options(extra: Partial<ObsidianTestOptions> = {}, env: Record<string, string> = {}): ResolvedOptions {
    return resolveOptions(
        { seedVault: seed, plugins: [{ dir: plugin.dir }], obsidianPath: asar, ...extra },
        { cwd: plugin.dir, env },
    );
}

interface Run {
    fake: ReturnType<typeof createFakeObsidian>;
    deps: SessionDeps;
    annotations: [string, string][];
}

function run(behavior: FakeObsidianBehavior = {}, env: Record<string, string> = {}): Run {
    const fake = createFakeObsidian(behavior);
    const deps: SessionDeps = {
        launch: fake.launch,
        io: fake.io,
        electron: { resolvePackageJson: () => "/plugin/node_modules/electron/package.json", exists: () => true },
        env,
        tmpRoot,
        now: () => 1_700_000_000_000,
    };
    return { fake, deps, annotations: [] };
}

const start = (opts: ResolvedOptions, r: Run) =>
    startSession(opts, r.deps, { label: "opens settings", annotate: (type, description) => r.annotations.push([type, description]) });

const leftovers = (): string[] => listTempDirs(tmpRoot);

describe("buildLaunchEnv", () => {
    it("drops ELECTRON_RUN_AS_NODE, VAULT_PLUGIN and undefined values, keeps the rest", () => {
        expect(
            buildLaunchEnv({ PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", VAULT_PLUGIN: "/vault", GONE: undefined, HOME: "/h" }),
        ).toEqual({ PATH: "/bin", HOME: "/h" });
    });
});

describe("prepareSession", () => {
    it("returns the asar and the plugin sources", () => {
        const { asar: found, sources } = prepareSession(options(), { env: {} });
        expect(found).toBe(asar);
        expect(sources.map((source) => source.id)).toEqual(["my-plugin"]);
    });

    it("fails before anything is created when Obsidian is missing", () => {
        expect(() => prepareSession(options({ obsidianPath: path.join(sandbox, "nope.asar") }), { env: {} })).toThrow(
            /obsidianPath points to/,
        );
    });

    it("fails when the plugin is not built", () => {
        fs.rmSync(path.join(plugin.dir, "main.js"));
        expect(() => prepareSession(options(), { env: {} })).toThrow(/no built main\.js/);
    });

    it("fails on a stale build unless the check is off", () => {
        plugin.write("src/main.ts", "x");
        const old = new Date(Date.now() - 60_000);
        fs.utimesSync(path.join(plugin.dir, "main.js"), old, old);
        expect(() => prepareSession(options(), { env: {} })).toThrow(/Stale build/);
        expect(() => prepareSession(options({ staleBuildCheck: false }), { env: {} })).not.toThrow();
    });

    it("checks the current plugin only, and a dependency only when it asks", () => {
        const dependency = createPluginFixture({ id: "dependency" });
        dependency.write("main.js", "//js");
        dependency.write("src/main.ts", "x");
        const old = new Date(Date.now() - 60_000);
        fs.utimesSync(path.join(dependency.dir, "main.js"), old, old);
        try {
            const plugins = (check?: boolean): Partial<ObsidianTestOptions> => ({
                plugins: [{ dir: plugin.dir }, { dir: dependency.dir, ...(check === undefined ? {} : { staleBuildCheck: check }) }],
            });
            expect(() => prepareSession(options(plugins()), { env: {} })).not.toThrow();
            expect(() => prepareSession(options(plugins(false)), { env: {} })).not.toThrow();
            expect(() => prepareSession(options(plugins(true)), { env: {} })).toThrow(/Stale build: main\.js of "dependency"/);
            expect(() => prepareSession(options(plugins(true), { OPDK_E2E_ALLOW_STALE_BUILD: "1" }), { env: {} })).not.toThrow();
        } finally {
            dependency.cleanup();
        }
    });

    it("fails when data names a plugin that is not installed", () => {
        expect(() => prepareSession(options({ data: { other: {} } }), { env: {} })).toThrow(/entry for "other"/);
    });

    it("fails when two plugins share an id", () => {
        const twin = createPluginFixture({ id: "my-plugin" });
        twin.write("main.js", "//js");
        try {
            expect(() => prepareSession(options({ plugins: [{ dir: plugin.dir }, { dir: twin.dir }] }), { env: {} })).toThrow(
                /both have the id "my-plugin"/,
            );
        } finally {
            twin.cleanup();
        }
    });
});

describe("startSession: happy path", () => {
    it("builds the vault and user-data folder, launches Obsidian and tears everything down", async () => {
        const r = run();
        const session = await start(
            options({ data: { "my-plugin": { units: "metric" } }, window: { width: 1200, height: 900 }, electronArgs: ["--use-mock-keychain"] }),
            r,
        );

        // Two folders exist while the test runs.
        expect(leftovers()).toHaveLength(2);
        const userdata = leftovers().find((name) => name.startsWith("opdk-e2e-userdata-"));
        const vaultRoot = leftovers().find((name) => name.startsWith("opdk-e2e-vault-"));
        const vaultPath = path.join(tmpRoot, vaultRoot ?? "", "vault");
        expect(session.vault.path).toBe(vaultPath);
        expect(path.basename(vaultRoot ?? "")).toMatch(/^opdk-e2e-vault-opens-settings-/);

        // The vault: seed content, plugin, community-plugins, data, headless app.json.
        expect(session.vault.read("Welcome.md")).toBe("# hi");
        expect(session.vault.read(".obsidian/plugins/my-plugin/main.js")).toBe("//js");
        expect(JSON.parse(session.vault.read(".obsidian/community-plugins.json"))).toEqual(["my-plugin"]);
        expect(JSON.parse(session.vault.read(".obsidian/plugins/my-plugin/data.json"))).toEqual({ units: "metric" });
        expect(JSON.parse(session.vault.read(".obsidian/app.json"))).toEqual({ settingsPopoutWindow: false, alwaysUpdateLinks: true });

        // obsidian.json registers the vault under a generated id; the trust key uses that id.
        const registry = JSON.parse(fs.readFileSync(path.join(tmpRoot, userdata ?? "", "obsidian.json"), "utf8")) as {
            last_open: string;
            vaults: Record<string, { path: string; open: boolean }>;
        };
        expect(Object.keys(registry.vaults)).toEqual([registry.last_open]);
        expect(registry.vaults[registry.last_open]).toMatchObject({ path: vaultPath, open: true });
        expect(r.fake.initScripts).toEqual([{ script: expect.any(Function) as unknown, arg: `enable-plugin-${registry.last_open}` }]);

        // The launch.
        expect(r.fake.launchOptions).toEqual({
            args: [asar, `--user-data-dir=${path.join(tmpRoot, userdata ?? "")}`, "--use-mock-keychain"],
            env: {},
            cwd: plugin.dir,
            timeout: 45_000,
        });
        expect(r.fake.launchOptions).not.toHaveProperty("executablePath");

        // Order: launch, trust before the window, size, dialogs, readiness.
        expect(r.fake.calls).toEqual([
            "launch",
            "addInitScript",
            "firstWindow",
            "page.on:dialog",
            'app.evaluate:{"width":1200,"height":900}',
            'waitForFunction:["my-plugin"]:{"polling":50,"timeout":30000}',
        ]);
        expect(r.annotations).toEqual([
            ["obsidian-launch-ms", "0"],
            ["obsidian-version", "1.14.5"],
            ["launch-mode", "electron"],
        ]);

        await session.teardown();
        expect(leftovers()).toEqual([]);
        expect(r.fake.calls).toContain("app.close");
        expect(r.fake.signals.filter((s) => s.signal !== 0)).toEqual([{ pid: -4242, signal: "SIGTERM" }]);
    });

    it("annotates the time from the launch call until the plugins are ready", async () => {
        const r = run();
        // The clock follows the fake's call log: 1000 until the launch is recorded, 1300 after it, 1750 once the
        // readiness wait is recorded. Reading the start late or annotating early changes the result.
        r.deps = {
            ...r.deps,
            now: () => {
                if (r.fake.calls.some((call) => call.startsWith("waitForFunction"))) {
                    return 1750;
                }
                return r.fake.calls.includes("launch") ? 1300 : 1000;
            },
        };
        const session = await start(options(), r);
        expect(r.annotations).toContainEqual(["obsidian-launch-ms", "750"]);
        await session.teardown();
    });

    it("fails before creating anything or launching when the Electron binary is not downloaded", async () => {
        const r = run();
        const deps: SessionDeps = { ...r.deps, electron: { resolvePackageJson: () => "/p/node_modules/electron/package.json", exists: () => false } };
        await expect(
            startSession(options(), deps, { label: "t", annotate: () => undefined }),
        ).rejects.toThrow(/node [^"]*electron[\\/]install\.js/);
        expect(r.fake.calls).toEqual([]);
        expect(leftovers()).toEqual([]);
    });

    it("dismisses native dialogs", async () => {
        const r = run();
        const session = await start(options(), r);
        const dismiss = vi.fn(() => Promise.resolve());
        r.fake.dialogHandlers[0]?.({ dismiss });
        expect(dismiss).toHaveBeenCalled();
        await session.teardown();
    });

    it("a dialog that cannot be dismissed (already closed) is not an error", async () => {
        const r = run();
        const session = await start(options(), r);
        const dismiss = vi.fn(() => Promise.reject(new Error("Dialog already handled")));
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            expect(() => {
                r.fake.dialogHandlers[0]?.({ dismiss });
            }).not.toThrow();
            await new Promise((resolve) => setImmediate(resolve));
            expect(dismiss).toHaveBeenCalled();
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", unhandled);
        }
        await session.teardown();
    });

    it("does not resize without a window option", async () => {
        const r = run();
        const session = await start(options(), r);
        expect(r.fake.calls.some((call) => call.startsWith("app.evaluate"))).toBe(false);
        await session.teardown();
    });

    it("keeps VAULT_PLUGIN and ELECTRON_RUN_AS_NODE out of Obsidian's environment", async () => {
        const r = run({}, { PATH: "/bin", VAULT_PLUGIN: "/real/dev/vault", ELECTRON_RUN_AS_NODE: "1" });
        const session = await start(options(), r);
        expect((r.fake.launchOptions as { env: Record<string, string> }).env).toEqual({ PATH: "/bin" });
        await session.teardown();
    });

    it("installs several plugins and lists them all", async () => {
        const second = createPluginFixture({ id: "second" });
        second.write("main.js", "//second");
        second.write("styles.css", "/*s*/");
        try {
            const r = run();
            const session = await start(options({ plugins: [{ dir: plugin.dir }, { dir: second.dir }] }), r);
            expect(JSON.parse(session.vault.read(".obsidian/community-plugins.json"))).toEqual(["my-plugin", "second"]);
            expect(session.vault.read(".obsidian/plugins/second/styles.css")).toBe("/*s*/");
            expect(r.fake.calls).toContain('waitForFunction:["my-plugin","second"]:{"polling":50,"timeout":30000}');
            await session.teardown();
        } finally {
            second.cleanup();
        }
    });

    it("kills the tree and removes the folders even when app.close() rejects", async () => {
        const r = run({ closeRejects: true });
        const session = await start(options(), r);
        await expect(session.teardown()).resolves.toBeUndefined();
        expect(r.fake.calls).toContain("app.close");
        expect(r.fake.signals.some((s) => s.signal === "SIGTERM")).toBe(true);
        expect(leftovers()).toEqual([]);
    });

    it("kills a tree that survives app.close() and a hanging close()", async () => {
        const r = run({ hangOnClose: true, ignoreSigterm: true });
        const session = await start(options({ timeouts: { close: 20 } }), r);
        await session.teardown();
        expect(r.fake.signals.filter((s) => s.signal !== 0).map((s) => s.signal)).toEqual(["SIGTERM", "SIGKILL"]);
        expect(leftovers()).toEqual([]);
    });
});

describe("startSession: version check", () => {
    it("passes when the expected version runs, and annotates both", async () => {
        const r = run({ version: "1.14.5" });
        const session = await start(options({ version: "1.14.5" }), r);
        expect(r.annotations).toContainEqual(["obsidian-expected-version", "1.14.5"]);
        await session.teardown();
    });

    it("fails on a mismatch and still cleans up", async () => {
        const r = run({ version: "1.13.7" });
        await expect(start(options({ version: "1.14.5" }), r)).rejects.toThrow(/expected 1\.14\.5, but 1\.13\.7 is running/);
        expect(leftovers()).toEqual([]);
        expect(r.fake.calls).toContain("app.close");
    });

    it("fails when a version was asked for but cannot be read", async () => {
        const r = run({ version: null });
        await expect(start(options({ version: "1.14.5" }), r)).rejects.toThrow(/Cannot verify OBSIDIAN_VERSION=1\.14\.5/);
        expect(leftovers()).toEqual([]);
    });

    it("does not fail when no version was asked for and none can be read", async () => {
        const r = run({ version: null });
        const session = await start(options(), r);
        expect(r.annotations).toContainEqual(["obsidian-version", "unknown"]);
        await session.teardown();
    });

    it("records unknown and goes on when reading the version throws and none was asked for", async () => {
        const r = run({ versionThrows: true });
        const session = await start(options(), r);
        expect(r.annotations).toContainEqual(["obsidian-version", "unknown"]);
        await session.teardown();
    });

    it("fails, naming the read error, when reading the version throws and one was asked for", async () => {
        const r = run({ versionThrows: true });
        await expect(start(options({ version: "1.14.5" }), r)).rejects.toThrow(
            /Cannot verify OBSIDIAN_VERSION=1\.14\.5.*Target page, context or browser has been closed/s,
        );
        expect(leftovers()).toEqual([]);
        expect(r.fake.calls).toContain("app.close");
    });

    it("takes the expected version from OBSIDIAN_VERSION", async () => {
        const r = run({ version: "1.15.0" });
        const session = await start(options({}, { OBSIDIAN_VERSION: "1.15.0" }), r);
        await session.teardown();
        expect(r.annotations).toContainEqual(["obsidian-expected-version", "1.15.0"]);
    });
});

describe("startSession: setup failures leave nothing behind", () => {
    const cases: { name: string; behavior: FakeObsidianBehavior; error: RegExp; appStarted: boolean; seedBroken?: boolean }[] = [
        { name: "the seed vault is missing", behavior: {}, error: /Seed vault .* does not exist/, appStarted: false, seedBroken: true },
        { name: "the launch fails", behavior: { failLaunch: true }, error: /launch failed/, appStarted: false },
        { name: "the trust script cannot be added", behavior: { failInitScript: true }, error: /init script failed/, appStarted: true },
        { name: "there is no window", behavior: { failFirstWindow: true }, error: /no window/, appStarted: true },
        {
            name: "a plugin never loads",
            behavior: { notReady: { missing: ["my-plugin"] } },
            error: /plugin not loaded: my-plugin/,
            appStarted: true,
        },
        {
            name: "the trust dialog blocks the vault",
            behavior: { notReady: { missing: ["my-plugin"], trustDialogVisible: true } },
            error: /dialog is open/,
            appStarted: true,
        },
    ];

    it.each(cases)("$name", async ({ behavior, error, appStarted, seedBroken }) => {
        const r = run(behavior);
        const opts = seedBroken === true ? options({ seedVault: path.join(sandbox, "missing-seed") }) : options();
        await expect(start(opts, r)).rejects.toThrow(error);
        expect(leftovers()).toEqual([]);
        if (appStarted) {
            expect(r.fake.calls).toContain("app.close");
            expect(r.fake.signals.some((s) => s.signal === "SIGTERM")).toBe(true);
        } else {
            expect(r.fake.signals).toEqual([]);
        }
    });

    it("creates nothing when the checks before setup fail", async () => {
        const r = run();
        await expect(start(options({ data: { typo: {} } }), r)).rejects.toThrow(/entry for "typo"/);
        expect(leftovers()).toEqual([]);
        expect(r.fake.calls).toEqual([]);
    });
});

describe("startSession: cleanup failures are loud", () => {
    it("fails teardown with the path of a folder that cannot be removed, and still removes the other one", async () => {
        const r = run();
        const session = await start(options(), r);
        const realRm = fs.rmSync.bind(fs);
        const stuck = leftovers().find((name) => name.includes("userdata")) ?? "";
        vi.spyOn(fs, "rmSync").mockImplementation((target, rmOptions) => {
            if (String(target).endsWith(stuck)) {
                throw new Error("ENOTEMPTY: directory not empty");
            }
            realRm(target, rmOptions);
        });
        const error = await session.teardown().then(
            () => undefined,
            (caught: unknown) => caught as Error,
        );
        vi.restoreAllMocks();
        expect(error?.message).toContain(`Could not remove ${path.join(tmpRoot, stuck)} after retries: ENOTEMPTY`);
        expect(leftovers()).toEqual([stuck]);
        fs.rmSync(path.join(tmpRoot, stuck), { recursive: true, force: true });
    });

    it("fails teardown when Obsidian survives SIGKILL, and still removes the folders", async () => {
        const r = run({ immortal: true });
        const session = await start(options(), r);
        await expect(session.teardown()).rejects.toThrow(/survived SIGKILL.*kill -9 -4242/s);
        expect(leftovers()).toEqual([]);
    }, 15_000);

    it("closes the app and removes the folders even when app.process() throws, and says so", async () => {
        const r = run({ processThrows: true });
        const session = await start(options(), r);
        await expect(session.teardown()).rejects.toThrow("process() is gone");
        expect(r.fake.calls).toContain("app.close");
        expect(leftovers()).toEqual([]);
    });

    it("still kills the tree when app.process() is gone after close (Playwright disposes the app object)", async () => {
        const r = run({ processGoneAfterClose: true });
        const session = await start(options(), r);
        await expect(session.teardown()).resolves.toBeUndefined();
        expect(r.fake.calls).toContain("app.close");
        expect(r.fake.signals.filter((s) => s.signal !== 0)).toEqual([{ pid: -4242, signal: "SIGTERM" }]);
        expect(leftovers()).toEqual([]);
    });

    it("fails teardown when Playwright gave no pid", async () => {
        const r = run({ pid: undefined });
        const session = await start(options(), r);
        await expect(session.teardown()).rejects.toThrow(/gave no process id/);
        expect(leftovers()).toEqual([]);
    });

    it("reports a setup error and a cleanup error together", async () => {
        const r = run({ failFirstWindow: true });
        const realRm = fs.rmSync.bind(fs);
        vi.spyOn(fs, "rmSync").mockImplementation((target, rmOptions) => {
            if (path.basename(String(target)).startsWith(`${TEMP_PREFIX}userdata`)) {
                throw new Error("EBUSY");
            }
            realRm(target, rmOptions);
        });
        const error = await start(options(), r).then(
            () => undefined,
            (caught: unknown) => caught as Error,
        );
        vi.restoreAllMocks();
        expect(error?.message).toContain("no window");
        expect(error?.message).toContain("Could not remove");
        expect(error?.message).toContain("EBUSY");
        for (const name of leftovers()) {
            fs.rmSync(path.join(tmpRoot, name), { recursive: true, force: true });
        }
    });
});

describe("startSession: trace and video of the Obsidian window", () => {
    interface Plan {
        plan: ArtifactPlan;
        attached: { name: string; path: string; contentType: string }[];
        out: string;
    }

    function planFor(trace: unknown, video: unknown, retry = 0): Plan {
        const out = path.join(sandbox, "results");
        fs.mkdirSync(out, { recursive: true });
        const attached: Plan["attached"] = [];
        return {
            out,
            attached,
            plan: {
                trace: parseTraceSetting(trace),
                video: parseVideoSetting(video),
                retry,
                outputPath: (name) => path.join(out, name),
                attach: (name, file, contentType) => attached.push({ name, path: file, contentType }),
            },
        };
    }

    const startWith = (r: Run, p: Plan, opts: ResolvedOptions = options()) =>
        startSession(opts, r.deps, { label: "opens settings", annotate: () => undefined, artifacts: p.plan });

    it("starts the trace right after launch, before the window is looked at, and stops it before the app closes", async () => {
        const r = run();
        const p = planFor("on", "off");
        const session = await startWith(r, p);
        expect(r.fake.calls.slice(0, 3)).toEqual(["launch", "tracing.start", "addInitScript"]);
        expect(r.fake.tracingStarts).toEqual([{ screenshots: true, snapshots: true, sources: true, title: "opens settings" }]);
        await session.teardown({ failed: false });
        expect(r.fake.calls.indexOf("tracing.stop")).toBeLessThan(r.fake.calls.indexOf("app.close"));
        expect(r.fake.tracingStops).toEqual([{ path: path.join(p.out, TRACE_FILE) }]);
        expect(p.attached).toEqual([{ name: "trace", path: path.join(p.out, TRACE_FILE), contentType: "application/zip" }]);
        expect(leftovers()).toEqual([]);
    });

    it("retain-on-failure: a passed test stops the trace without a path and attaches nothing", async () => {
        const r = run();
        const p = planFor("retain-on-failure", "off");
        const session = await startWith(r, p);
        await session.teardown({ failed: false });
        expect(r.fake.tracingStops).toEqual([undefined]);
        expect(p.attached).toEqual([]);
    });

    it("retain-on-failure: a failed test writes the zip and attaches it", async () => {
        const r = run();
        const p = planFor("retain-on-failure", "off");
        const session = await startWith(r, p);
        await session.teardown({ failed: true });
        expect(r.fake.tracingStops).toEqual([{ path: path.join(p.out, TRACE_FILE) }]);
        expect(p.attached.map((a) => a.name)).toEqual(["trace"]);
    });

    it("treats a session that never finished starting as failed", async () => {
        const r = run({ failFirstWindow: true });
        const p = planFor("retain-on-failure", "off");
        await expect(startWith(r, p)).rejects.toThrow("no window");
        expect(r.fake.tracingStops).toEqual([{ path: path.join(p.out, TRACE_FILE) }]);
        expect(p.attached.map((a) => a.name)).toEqual(["trace"]);
        expect(r.fake.calls).toContain("app.close");
        expect(leftovers()).toEqual([]);
    });

    it("passes the capture switches of the config to tracing.start", async () => {
        const r = run();
        const p = planFor({ mode: "on", screenshots: false, sources: false }, "off");
        const session = await startWith(r, p);
        expect(r.fake.tracingStarts).toEqual([{ screenshots: false, snapshots: true, sources: false, title: "opens settings" }]);
        await session.teardown();
    });

    it("does not touch tracing or the launch options when both are off, or when the retry mode skips this attempt", async () => {
        const off = run();
        await (await startWith(off, planFor("off", "off"))).teardown();
        const skipped = run();
        await (await startWith(skipped, planFor("on-first-retry", "on-first-retry", 0))).teardown();
        for (const r of [off, skipped]) {
            expect(r.fake.calls).not.toContain("tracing.start");
            expect(r.fake.calls).not.toContain("tracing.stop");
            expect(r.fake.launchOptions).not.toHaveProperty("recordVideo");
        }
    });

    it("traces the first retry under on-first-retry", async () => {
        const r = run();
        const p = planFor("on-first-retry", "off", 1);
        await (await startWith(r, p)).teardown({ failed: false });
        expect(p.attached.map((a) => a.name)).toEqual(["trace"]);
    });

    it("a failing tracing.stop is reported, and the app is still closed and the folders removed", async () => {
        const r = run({ tracingStopFails: true });
        const p = planFor("on", "off");
        const session = await startWith(r, p);
        await expect(session.teardown({ failed: false })).rejects.toThrow(/stop the trace of the Obsidian window: tracing stop failed/);
        expect(r.fake.calls).toContain("app.close");
        expect(r.fake.signals.some((s) => s.signal === "SIGTERM")).toBe(true);
        expect(p.attached).toEqual([]);
        expect(leftovers()).toEqual([]);
    });

    it("a tracing.stop that hangs is cut off at the trace budget, naming timeouts.trace, then the app is closed", async () => {
        const r = run({ tracingStopHangs: true });
        const session = await startWith(r, planFor("on", "off"), options({ timeouts: { trace: 20 } }));
        await expect(session.teardown({ failed: false })).rejects.toThrow(
            /Stopping the Obsidian trace took longer than 20 ms \(timeouts\.trace\)/,
        );
        expect(r.fake.calls).toContain("app.close");
        expect(leftovers()).toEqual([]);
    });

    it("a slow tracing.stop is bounded by timeouts.trace, not by timeouts.close", async () => {
        const r = run({ tracingStopDelayMs: 150 });
        const p = planFor("on", "off");
        const session = await startWith(r, p, options({ timeouts: { close: 20, trace: 2_000 } }));
        await session.teardown({ failed: false });
        expect(p.attached.map((a) => a.name)).toEqual(["trace"]);
        expect(leftovers()).toEqual([]);
    });

    it("a tracing.stop slower than timeouts.trace fails even when timeouts.close is generous", async () => {
        const r = run({ tracingStopDelayMs: 500 });
        const session = await startWith(r, planFor("on", "off"), options({ timeouts: { close: 5_000, trace: 30 } }));
        await expect(session.teardown({ failed: false })).rejects.toThrow(/\(timeouts\.trace\)/);
        expect(r.fake.calls).toContain("app.close");
        expect(leftovers()).toEqual([]);
    });

    it("a failing tracing.start fails the start and closes what was launched", async () => {
        const r = run({ tracingStartFails: true });
        await expect(startWith(r, planFor("on", "off"))).rejects.toThrow("tracing start failed");
        expect(r.fake.calls).toContain("app.close");
        expect(r.fake.calls).not.toContain("tracing.stop");
        expect(leftovers()).toEqual([]);
    });

    it("a tracing failure and a cleanup failure are reported together", async () => {
        const r = run({ tracingStopFails: true, processThrows: true });
        const session = await startWith(r, planFor("on", "off"));
        const error = await session.teardown({ failed: false }).then(
            () => undefined,
            (caught: unknown) => caught as Error,
        );
        expect(error?.message).toContain("tracing stop failed");
        expect(error?.message).toContain("process() is gone");
        expect(leftovers()).toEqual([]);
    });

    it("asks for the video in the launch options, with the configured size", async () => {
        const r = run();
        const p = planFor("off", { mode: "on", size: { width: 640, height: 480 } });
        await (await startWith(r, p)).teardown();
        expect(r.fake.launchOptions).toMatchObject({ recordVideo: { dir: path.join(p.out, "video"), size: { width: 640, height: 480 } } });
    });

    it("asks for the video without a size when the config has none", async () => {
        const r = run();
        const p = planFor("off", "on");
        await (await startWith(r, p)).teardown();
        expect((r.fake.launchOptions as { recordVideo: object }).recordVideo).toEqual({ dir: path.join(p.out, "video") });
    });

    it("keeps the video of a failed test under retain-on-failure and attaches it", async () => {
        const video = path.join(sandbox, "results", "video", "a.webm");
        const p = planFor("off", "retain-on-failure");
        fs.mkdirSync(path.dirname(video));
        fs.writeFileSync(video, "webm");
        const r = run({ videoPath: video });
        const session = await startWith(r, p);
        await session.teardown({ failed: true });
        expect(p.attached).toEqual([{ name: "video", path: video, contentType: "video/webm" }]);
        expect(fs.existsSync(video)).toBe(true);
        expect(r.fake.calls.indexOf("app.close")).toBeGreaterThan(-1);
    });

    it("a passed test under retain-on-failure attaches nothing and leaves no video file", async () => {
        const video = path.join(sandbox, "results", "video", "a.webm");
        const p = planFor("retain-on-failure", "retain-on-failure");
        fs.mkdirSync(path.dirname(video));
        fs.writeFileSync(video, "webm");
        const r = run({ videoPath: video });
        const session = await startWith(r, p);
        await session.teardown({ failed: false });
        expect(p.attached).toEqual([]);
        expect(fs.existsSync(video)).toBe(false);
        expect(r.fake.tracingStops).toEqual([undefined]);
        expect(fs.existsSync(path.join(p.out, TRACE_FILE))).toBe(false);
    });

    it("keeps the video of a passed test under `on`", async () => {
        const video = path.join(sandbox, "results", "a.webm");
        const p = planFor("off", "on");
        fs.writeFileSync(video, "webm");
        const session = await startWith(run({ videoPath: video }), p);
        await session.teardown({ failed: false });
        expect(p.attached.map((a) => a.name)).toEqual(["video"]);
    });

    it("finishes the video after the app has closed", async () => {
        const video = path.join(sandbox, "results", "a.webm");
        const p = planFor("off", "on");
        fs.writeFileSync(video, "webm");
        const r = run({ videoPath: video });
        const session = await startWith(r, p);
        let closedAtAttach = false;
        const attach = p.plan.attach;
        (p.plan as { attach: ArtifactPlan["attach"] }).attach = (name, file, type) => {
            closedAtAttach = r.fake.calls.includes("app.close");
            attach(name, file, type);
        };
        await session.teardown({ failed: false });
        expect(closedAtAttach).toBe(true);
    });

    it("fails the teardown, naming the file, when a kept video is missing", async () => {
        const video = path.join(sandbox, "results", "gone.webm");
        const session = await startWith(run({ videoPath: video }), planFor("off", "on"));
        await expect(session.teardown({ failed: true })).rejects.toThrow(`expected at ${video}`);
        expect(leftovers()).toEqual([]);
    });

    it("a video that never finishes is cut off at the close budget; the folders are still removed", async () => {
        const r = run({ videoPath: "/x/a.webm", videoPathHangs: true });
        const session = await startWith(r, planFor("off", "on"), options({ timeouts: { close: 20 } }));
        await expect(session.teardown({ failed: true })).rejects.toThrow(/did not finish the Obsidian video within 20 ms/);
        expect(leftovers()).toEqual([]);
    });

    it("does nothing for the video when the window never had one (no window opened)", async () => {
        const r = run({ failFirstWindow: true });
        const p = planFor("off", "on");
        await expect(startWith(r, p)).rejects.toThrow("no window");
        expect(p.attached).toEqual([]);
        expect(leftovers()).toEqual([]);
    });

    it("does nothing when win.video() is null", async () => {
        const p = planFor("off", "on");
        const session = await startWith(run(), p);
        await session.teardown({ failed: true });
        expect(p.attached).toEqual([]);
    });
});

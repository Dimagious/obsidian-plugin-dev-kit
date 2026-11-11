import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveOptions } from "./options.js";

const context = { cwd: "/work/plugin", env: {} };
const base = { seedVault: "e2e/vault" };

describe("resolveOptions: defaults", () => {
    it("resolves the seed vault against cwd and installs the cwd plugin", () => {
        const resolved = resolveOptions(base, context);
        expect(resolved.seedVault).toBe(path.resolve("/work/plugin", "e2e/vault"));
        expect(resolved.pluginDirs).toEqual(["/work/plugin"]);
        expect(resolved.data).toEqual({});
        expect(resolved.window).toBeUndefined();
        expect(resolved.electronArgs).toEqual([]);
        expect(resolved.expectedVersion).toBeNull();
        expect(resolved.timeouts).toEqual({ launch: 45_000, ready: 30_000, close: 5_000, trace: 60_000 });
        expect(resolved.helperTimeouts).toEqual({ settings: 15_000, metadataCache: 45_000, compose: 5_000, theme: 5_000, ui: 10_000 });
        expect(resolved.staleCheckDirs).toEqual(["/work/plugin"]);
        expect(resolved.sweepAfterHours).toBe(2);
        expect(resolved.seedVaultSource).toBe("option");
        expect(resolved.demo).toEqual({ outDir: path.resolve("/work/plugin", ".opdk/demo"), scale: 2, forbiddenSelectors: [] });
    });
});

describe("resolveOptions: values", () => {
    it("takes every option", () => {
        const resolved = resolveOptions(
            {
                seedVault: "v",
                plugins: [{ dir: "." }, { dir: "../other" }],
                data: { a: { units: "metric" } },
                window: { width: 1200, height: 800 },
                obsidianPath: "/x/app.asar",
                electronArgs: ["--use-mock-keychain"],
                version: "1.14.5",
                timeouts: { ready: 90_000, helpers: { metadataCache: 120_000, ui: 20_000 } },
                staleBuildCheck: false,
                sweepAfterHours: 6,
                demo: { outDir: "shots", scale: 1, forbiddenSelectors: [".key"] },
            },
            context,
        );
        expect(resolved.pluginDirs).toEqual(["/work/plugin", "/work/other"]);
        expect(resolved.data).toEqual({ a: { units: "metric" } });
        expect(resolved.window).toEqual({ width: 1200, height: 800 });
        expect(resolved.obsidianPath).toBe("/x/app.asar");
        expect(resolved.electronArgs).toEqual(["--use-mock-keychain"]);
        expect(resolved.expectedVersion).toBe("1.14.5");
        expect(resolved.timeouts).toEqual({ launch: 45_000, ready: 90_000, close: 5_000, trace: 60_000 });
        expect(resolved.helperTimeouts).toEqual({ settings: 15_000, metadataCache: 120_000, compose: 5_000, theme: 5_000, ui: 20_000 });
        expect(resolved.staleCheckDirs).toEqual([]);
        expect(resolved.sweepAfterHours).toBe(6);
        expect(resolved.demo).toEqual({ outDir: "/work/plugin/shots", scale: 1, forbiddenSelectors: [".key"] });
    });

    it("rejects a bad demo option naming the key", () => {
        expect(() => resolveOptions({ ...base, demo: { outdir: "x" } }, context)).toThrow('unknown key "demo.outdir"');
        expect(() => resolveOptions({ ...base, demo: { scale: 9 } }, context)).toThrow('"demo.scale"');
    });

    it("lets sweepAfterHours be switched off", () => {
        expect(resolveOptions({ ...base, sweepAfterHours: false }, context).sweepAfterHours).toBe(false);
    });
});

describe("resolveOptions: stale build check per plugin", () => {
    const plugins = (extra: object[]): object => ({ ...base, plugins: extra });

    it("checks the plugin in the current directory and leaves the others alone by default", () => {
        const resolved = resolveOptions(plugins([{ dir: "." }, { dir: "../dependency" }]), context);
        expect(resolved.staleCheckDirs).toEqual(["/work/plugin"]);
    });

    it("recognises the current directory however it is spelled", () => {
        expect(resolveOptions(plugins([{ dir: "../dependency" }, { dir: "./" }]), context).staleCheckDirs).toEqual(["/work/plugin"]);
    });

    it("checks a dependency plugin that asks for it", () => {
        const resolved = resolveOptions(plugins([{ dir: "." }, { dir: "../dependency", staleBuildCheck: true }]), context);
        expect(resolved.staleCheckDirs).toEqual(["/work/plugin", "/work/dependency"]);
    });

    it("lets the top-level option turn off the current plugin only", () => {
        const options = { ...plugins([{ dir: "." }, { dir: "../dependency", staleBuildCheck: true }]), staleBuildCheck: false };
        expect(resolveOptions(options, context).staleCheckDirs).toEqual(["/work/dependency"]);
    });

    it("lets an entry switch the check off for the current plugin and on again over a false top level", () => {
        expect(resolveOptions(plugins([{ dir: ".", staleBuildCheck: false }]), context).staleCheckDirs).toEqual([]);
        expect(resolveOptions({ ...plugins([{ dir: ".", staleBuildCheck: true }]), staleBuildCheck: false }, context).staleCheckDirs).toEqual([
            "/work/plugin",
        ]);
    });

    it("does not check a plugin set that does not include the current directory", () => {
        expect(resolveOptions(plugins([{ dir: "../a" }, { dir: "../b" }]), context).staleCheckDirs).toEqual([]);
    });
});

describe("resolveOptions: env overrides", () => {
    it("OPDK_E2E_VAULT replaces the seed vault", () => {
        const resolved = resolveOptions(base, { cwd: "/work/plugin", env: { OPDK_E2E_VAULT: "../demo-vault" } });
        expect(resolved.seedVault).toBe("/work/demo-vault");
        expect(resolved.seedVaultSource).toBe("env");
    });

    it("an empty OPDK_E2E_VAULT is ignored", () => {
        expect(resolveOptions(base, { cwd: "/work/plugin", env: { OPDK_E2E_VAULT: "" } }).seedVault).toBe(
            path.resolve("/work/plugin", "e2e/vault"),
        );
        expect(resolveOptions(base, { cwd: "/work/plugin", env: { OPDK_E2E_VAULT: "" } }).seedVaultSource).toBe("option");
    });

    it("OBSIDIAN_VERSION wins over the version option", () => {
        const resolved = resolveOptions({ ...base, version: "1.14.5" }, { cwd: "/p", env: { OBSIDIAN_VERSION: "1.15.0" } });
        expect(resolved.expectedVersion).toBe("1.15.0");
    });

    it("OPDK_E2E_ALLOW_STALE_BUILD=1 switches the stale check off", () => {
        expect(resolveOptions(base, { cwd: "/p", env: { OPDK_E2E_ALLOW_STALE_BUILD: "1" } }).staleCheckDirs).toEqual([]);
    });

    it("OPDK_E2E_ALLOW_STALE_BUILD=0 does not", () => {
        expect(resolveOptions(base, { cwd: "/p", env: { OPDK_E2E_ALLOW_STALE_BUILD: "0" } }).staleCheckDirs).toEqual(["/p"]);
    });

    it("OPDK_E2E_ALLOW_STALE_BUILD=1 also wins over a plugin that asks for the check", () => {
        const options = { ...base, plugins: [{ dir: ".", staleBuildCheck: true }] };
        expect(resolveOptions(options, { cwd: "/p", env: { OPDK_E2E_ALLOW_STALE_BUILD: "1" } }).staleCheckDirs).toEqual([]);
    });

    it("rejects a channel alias in OBSIDIAN_VERSION and names the variable", () => {
        expect(() => resolveOptions(base, { cwd: "/p", env: { OBSIDIAN_VERSION: "latest" } })).toThrow(
            /OBSIDIAN_VERSION is "latest", which is not an explicit x\.y\.z/,
        );
    });
});

describe("resolveOptions: errors name the key", () => {
    const fail = (value: unknown, message: RegExp | string): void => {
        expect(() => resolveOptions(value, context)).toThrow(message);
    };

    it("rejects non-objects", () => {
        fail(undefined, /options must be an object/);
        fail(null, /options must be an object/);
        fail([], /options must be an object/);
        fail("vault", /options must be an object/);
    });

    it("requires seedVault", () => {
        fail({}, '"seedVault" is required');
        fail({ seedVault: "" }, '"seedVault" is required');
        fail({ seedVault: 3 }, '"seedVault" is required');
    });

    it("rejects an unknown key and lists the known ones", () => {
        fail({ ...base, seedvault: "x" }, /unknown option "seedvault". Known options: seedVault, plugins/);
    });

    it("rejects bad plugins", () => {
        fail({ ...base, plugins: [] }, '"plugins" must be a non-empty array');
        fail({ ...base, plugins: "." }, '"plugins" must be a non-empty array');
        fail({ ...base, plugins: ["."] }, '"plugins[0]" must be an object');
        fail({ ...base, plugins: [{ dir: "" }] }, '"plugins[0]" must be an object');
        fail({ ...base, plugins: [{ dir: "." }, { dir: "/work/plugin" }] }, /lists \/work\/plugin twice/);
        fail({ ...base, plugins: [{ dir: ".", staleBuildCheck: "no" }] }, '"plugins[0].staleBuildCheck" must be a boolean');
        fail({ ...base, plugins: [{ dir: ".", stale: false }] }, 'unknown key "plugins[0].stale"');
    });

    it("rejects bad data", () => {
        fail({ ...base, data: [] }, '"data" must be an object keyed by plugin id');
        fail({ ...base, data: { a: "x" } }, '"data["a"]" must be an object');
        fail({ ...base, data: { a: [] } }, '"data["a"]" must be an object');
    });

    it("rejects bad window", () => {
        fail({ ...base, window: 3 }, '"window" must be an object');
        fail({ ...base, window: { width: 100 } }, '"window.height" is required and must be a positive integer');
        fail({ ...base, window: { width: 0, height: 5 } }, '"window.width" is required');
        fail({ ...base, window: { width: 1.5, height: 5 } }, '"window.width" is required');
        fail({ ...base, window: { width: 5, height: 5, depth: 1 } }, 'unknown key "window.depth"');
    });

    it("rejects bad strings", () => {
        fail({ ...base, obsidianPath: 3 }, '"obsidianPath" must be a string');
        fail({ ...base, version: 3 }, '"version" must be a string');
        fail({ ...base, version: "1.14" }, /the "version" option is "1\.14", which is not an explicit x\.y\.z/);
    });

    it("rejects bad electronArgs and the reserved user-data-dir", () => {
        fail({ ...base, electronArgs: "--x" }, '"electronArgs" must be an array of non-empty strings');
        fail({ ...base, electronArgs: [""] }, '"electronArgs" must be an array of non-empty strings');
        fail({ ...base, electronArgs: [1] }, '"electronArgs" must be an array of non-empty strings');
        fail({ ...base, electronArgs: ["--user-data-dir=/x"] }, /must not contain --user-data-dir=\/x/);
    });

    it("rejects bad timeouts", () => {
        fail({ ...base, timeouts: 5 }, '"timeouts" must be an object');
        fail({ ...base, timeouts: { boot: 5 } }, 'unknown key "timeouts.boot"');
        fail({ ...base, timeouts: { ready: -1 } }, '"timeouts.ready" is required and must be a positive integer');
        fail({ ...base, timeouts: { launch: "5" } }, '"timeouts.launch"');
        fail({ ...base, timeouts: { trace: 0 } }, '"timeouts.trace" is required and must be a positive integer');
        fail({ ...base, timeouts: { trace: "60" } }, '"timeouts.trace"');
        fail({ ...base, timeouts: { helpers: 5 } }, '"timeouts.helpers" must be an object');
        fail({ ...base, timeouts: { helpers: { metadata: 5 } } }, 'unknown key "timeouts.helpers.metadata"');
        fail({ ...base, timeouts: { helpers: { metadataCache: 0 } } }, '"timeouts.helpers.metadataCache" is required and must be a positive integer');
        fail({ ...base, timeouts: { helpers: { ui: "5" } } }, '"timeouts.helpers.ui"');
    });

    it("rejects bad staleBuildCheck and sweepAfterHours", () => {
        fail({ ...base, staleBuildCheck: "no" }, '"staleBuildCheck" must be a boolean');
        fail({ ...base, sweepAfterHours: 0 }, '"sweepAfterHours" must be a positive number of hours or false');
        fail({ ...base, sweepAfterHours: true }, '"sweepAfterHours" must be a positive number');
        fail({ ...base, sweepAfterHours: Number.NaN }, '"sweepAfterHours" must be a positive number');
    });
});

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReporter } from "../cli/reporter.js";
import { createContext, createPluginFixture, type PluginFixture } from "../test-support/plugin-fixture.js";
import { buildCommand } from "./commands.js";
import { resolveBuild } from "./options.js";
import { runVaultBuild, type VaultBuildOptions } from "./vault.js";

const MAIN_TS = (word: string): string => `export default class P {\n    word = "${word}";\n}\n`;

let plugin: PluginFixture;
let vault: string;

beforeEach(() => {
    plugin = createPluginFixture();
    plugin.write("src/main.ts", MAIN_TS("first"));
    plugin.write("src/styles/main.css", '@import "./a.css";\n');
    plugin.write("src/styles/a.css", ".a { color: red; }\n");
    vault = mkdtempSync(path.join(tmpdir(), "opdk-vault-"));
});

afterEach(() => {
    plugin.cleanup();
    rmSync(vault, { recursive: true, force: true });
});

/**
 * Resolves to `false` after a short pause; raced against a promise to ask "is it still pending?".
 * The pause covers esbuild's dispose, so a watch that returns early is seen as finished.
 */
const nextTick = (): Promise<boolean> =>
    new Promise((resolve) => {
        setTimeout(() => {
            resolve(false);
        }, 150);
    });

/** Empty when the file is not there (yet), so waiting predicates can poll it. */
const inVault = (name: string): string => {
    const file = path.join(vault, name);
    return existsSync(file) ? readFileSync(file, "utf8") : "";
};

describe("opdk build --vault (one shot)", () => {
    it("writes an unminified main.js, a fresh styles.css and manifest.json into the vault folder", async () => {
        // A stale styles.css in the plugin root must not be what the vault gets.
        writeFileSync(path.join(plugin.dir, "styles.css"), ".stale{}");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run(["--vault", vault], ctx)).toBe(0);

        expect(inVault("main.js")).toContain("// src/main.ts");
        expect(inVault("main.js").split("\n").length).toBeGreaterThan(10);
        expect(inVault("main.js").trimEnd().endsWith("module.exports = module.exports.default || module.exports;")).toBe(true);
        expect(inVault("styles.css")).toBe(".a { color: red; }\n\n");
        expect(JSON.parse(inVault("manifest.json"))).toMatchObject({ id: "fixture-plugin" });
        expect(existsSync(path.join(plugin.dir, "main.js"))).toBe(false);
        expect(ctx.out.join("")).toContain(`✓ build   fixture-plugin: assets copied to ${vault}`);
        expect(ctx.err).toEqual([]);
    });

    it("takes the folder from VAULT_PLUGIN when no directory is given", async () => {
        const target = path.join(vault, "nested", "plugin");
        const ctx = createContext(plugin.dir, { VAULT_PLUGIN: target });
        expect(await buildCommand.run(["--vault"], ctx)).toBe(0);
        expect(readFileSync(path.join(target, "main.js"), "utf8")).toContain("first");
        expect(ctx.out.join("")).toContain(`· build   fixture-plugin: vault target ${target} (from VAULT_PLUGIN)`);
    });

    it("says the target came from the flag when --vault <dir> is given", async () => {
        const ctx = createContext(plugin.dir, { VAULT_PLUGIN: path.join(vault, "ignored") });
        expect(await buildCommand.run([`--vault=${vault}`], ctx)).toBe(0);
        expect(ctx.out.join("")).toContain(`· build   fixture-plugin: vault target ${vault} (from --vault)`);
    });

    it("prefers the flag over VAULT_PLUGIN", async () => {
        const other = path.join(vault, "other");
        await buildCommand.run(["--vault", vault], createContext(plugin.dir, { VAULT_PLUGIN: other }));
        expect(existsSync(path.join(other, "main.js"))).toBe(false);
        expect(existsSync(path.join(vault, "main.js"))).toBe(true);
    });

    it("fails with the plugin id when neither is set", async () => {
        await expect(buildCommand.run(["--vault"], createContext(plugin.dir))).rejects.toThrow(
            ".obsidian/plugins/fixture-plugin",
        );
    });

    it("copies a hand-written styles.css when the plugin has no CSS entry", async () => {
        plugin.write("opdk.config.mjs", 'export default { build: { css: { entry: "src/nope.css" } } };\n');
        plugin.write("styles.css", ".hand{}");
        expect(await buildCommand.run(["--vault", vault], createContext(plugin.dir))).toBe(0);
        expect(inVault("styles.css")).toBe(".hand{}");
    });

    it("does not run the bundle check", async () => {
        plugin.write("src/main.ts", "export default class P { dir = process.env.HOME; }\n");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run(["--vault", vault], ctx)).toBe(0);
        expect(ctx.out.join("")).not.toContain("bundle ");
    });

    it("exits 1 on a compile error and prints it", async () => {
        plugin.write("src/main.ts", "export default class {");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run(["--vault", vault], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("src/main.ts");
        expect(ctx.err.join("")).toContain("✗ build   fixture-plugin: build had 1 error(s)");
    });

    it("exits 1 when the CSS has a missing import", async () => {
        plugin.write("src/styles/a.css", '@import "./gone.css";');
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run(["--vault", vault], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("CSS build or copy failed");
        expect(ctx.err.join("")).toContain("gone.css");
    });
});

describe("opdk build --vault folder argument", () => {
    it("refuses a target that resolves to the plugin root, even with --force", async () => {
        for (const args of [["--vault", plugin.dir], ["--vault", ".", "--force"]]) {
            const ctx = createContext(plugin.dir);
            expect(await buildCommand.run(args, ctx)).toBe(1);
            expect(ctx.err.join("")).toContain("the vault folder cannot be the plugin root");
        }
        expect(existsSync(path.join(plugin.dir, "main.js"))).toBe(false);
    });

    it("refuses a value starting with ~ because nothing expands it, and writes nothing", async () => {
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run(["--vault", "~/vault/.obsidian/plugins/x"], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain('"~/vault/.obsidian/plugins/x" starts with "~", which is not expanded here. Pass an absolute path.');
        expect(existsSync(path.join(plugin.dir, "~"))).toBe(false);
    });

    it("applies the same refusal to a VAULT_PLUGIN that starts with ~", async () => {
        const ctx = createContext(plugin.dir, { VAULT_PLUGIN: "~/p" });
        expect(await buildCommand.run(["--vault"], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("not expanded here");
    });

    it("rejects an empty directory before building", async () => {
        await expect(buildCommand.run(["--vault", ""], createContext(plugin.dir))).rejects.toThrow("--vault needs a non-empty directory");
    });

    it("bundles an imported .css file as a string by default", async () => {
        plugin.write("src/main.ts", 'import css from "./inline.css";\nexport default class P { css = css; }\n');
        plugin.write("src/inline.css", ".inline-marker { color: red; }\n");
        expect(await buildCommand.run(["--vault", vault], createContext(plugin.dir))).toBe(0);
        expect(inVault("main.js")).toContain(".inline-marker");
    });
});

describe("opdk build --vault target guard", () => {
    const holds = (id: string): void => {
        writeFileSync(path.join(vault, "manifest.json"), JSON.stringify({ id, name: "Other", version: "9.9.9" }));
        writeFileSync(path.join(vault, "main.js"), "// other plugin");
    };

    it("refuses a folder that holds another plugin and writes nothing", async () => {
        holds("other-plugin");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run(["--vault", vault], ctx)).toBe(1);

        expect(ctx.err.join("")).toBe(
            `✗ build   fixture-plugin: ${vault} holds plugin other-plugin, not fixture-plugin. Check VAULT_PLUGIN / --vault, or pass --force to overwrite it.\n`,
        );
        expect(inVault("main.js")).toBe("// other plugin");
        expect(JSON.parse(inVault("manifest.json"))).toMatchObject({ id: "other-plugin", version: "9.9.9" });
        expect(existsSync(path.join(vault, "styles.css"))).toBe(false);
    });

    it("refuses the folder VAULT_PLUGIN points at too", async () => {
        holds("other-plugin");
        const ctx = createContext(plugin.dir, { VAULT_PLUGIN: vault });
        expect(await buildCommand.run(["--vault"], ctx)).toBe(1);
        expect(inVault("main.js")).toBe("// other plugin");
    });

    it("builds into a folder that holds the same plugin", async () => {
        holds("fixture-plugin");
        expect(await buildCommand.run(["--vault", vault], createContext(plugin.dir))).toBe(0);
        expect(inVault("main.js")).toContain('"first"');
    });

    it("builds into an empty folder", async () => {
        expect(await buildCommand.run(["--vault", vault], createContext(plugin.dir))).toBe(0);
        expect(inVault("main.js")).toContain('"first"');
    });

    it.each(["not json {", JSON.stringify({ name: "no id" }), JSON.stringify({ id: 7 })])(
        "treats an unreadable manifest (%s) as a fresh folder",
        async (content) => {
            writeFileSync(path.join(vault, "manifest.json"), content);
            expect(await buildCommand.run(["--vault", vault], createContext(plugin.dir))).toBe(0);
            expect(JSON.parse(inVault("manifest.json"))).toMatchObject({ id: "fixture-plugin" });
        },
    );

    it("overwrites another plugin with --force", async () => {
        holds("other-plugin");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run(["--vault", vault, "--force"], ctx)).toBe(0);
        expect(inVault("main.js")).toContain('"first"');
        expect(JSON.parse(inVault("manifest.json"))).toMatchObject({ id: "fixture-plugin" });
    });
});

describe("opdk build --vault, esbuild messages and css: false", () => {
    it("prints esbuild warnings to stderr and still exits 0", async () => {
        plugin.write("src/main.ts", 'export default { a: 1, a: 2 };\n');
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run(["--vault", vault], ctx)).toBe(0);
        expect(ctx.err.join("")).toContain('Duplicate key "a"');
    });

    it("with css: false copies a root styles.css and does not run the CSS step", async () => {
        plugin.write("opdk.config.mjs", "export default { build: { css: false } };\n");
        plugin.write("styles.css", ".root{}");
        const ctx = createContext(plugin.dir);
        expect(await buildCommand.run(["--vault", vault], ctx)).toBe(0);
        expect(inVault("styles.css")).toBe(".root{}");
        expect(ctx.out.join("")).not.toContain("css ");
    });

    it("with css: false and no root styles.css copies only main.js and manifest.json", async () => {
        plugin.write("opdk.config.mjs", "export default { build: { css: false } };\n");
        expect(await buildCommand.run(["--vault", vault], createContext(plugin.dir))).toBe(0);
        expect(existsSync(path.join(vault, "styles.css"))).toBe(false);
        expect(inVault("manifest.json")).not.toBe("");
    });
});

/** Polling interval of the watchers, and the budget a polled change gets to reach the vault. */
const POLL_MS = 300;
const POLL_BUDGET_MS = POLL_MS * 5;

/** Open fs.watchFile handles in this process. Compared before and after a run to prove they were released. */
const statWatchers = (): number => process.getActiveResourcesInfo().filter((name) => name === "StatWatcher").length;

describe("opdk build --vault --watch", () => {
    interface Run {
        readonly done: Promise<number>;
        readonly controller: AbortController;
        /** stdout and stderr interleaved; stream-specific assertions live in the one-shot tests. */
        readonly out: string[];
        /** Waits for the sync that esbuild's own first watch rebuild produces, so a later change is really watched. */
        settled(): Promise<void>;
        /** Whether `done` has settled, judged one macrotask later. */
        isDone(): Promise<boolean>;
        /**
         * Waits, without sleeping, until `predicate` holds, re-checking after each asset sync.
         * Fails fast when the watch returned early, and when `budgetMs` passes.
         */
        until(predicate: () => boolean, budgetMs?: number): Promise<void>;
        /** Checks the watch is still running, aborts it and checks the exit code. */
        stop(): Promise<void>;
    }

    function start(overrides: Partial<VaultBuildOptions> = {}): Run {
        const controller = new AbortController();
        const out: string[] = [];
        const waiters: (() => void)[] = [];
        let syncs = 0;
        let watching = false;
        let finished: string | undefined;
        const wakeAll = (): void => {
            for (const wake of waiters.splice(0)) {
                wake();
            }
        };
        const done = runVaultBuild({
            cwd: plugin.dir,
            manifest: { id: "fixture-plugin", name: "Fixture", version: "1.0.0" },
            build: resolveBuild(undefined),
            dir: vault,
            watch: true,
            reporter: createReporter({
                stdout: (text) => {
                    out.push(text);
                    if (text.includes("Watching for changes")) {
                        watching = true;
                        wakeAll();
                    }
                },
                stderr: (text) => {
                    out.push(text);
                },
                colorStdout: false,
                colorStderr: false,
            }),
            signal: controller.signal,
            onAssetsSynced: () => {
                syncs++;
                wakeAll();
            },
            ...overrides,
        });
        done.then(
            (code) => {
                finished = `watch returned early with exit ${String(code)}`;
                wakeAll();
            },
            (error: unknown) => {
                finished = `watch threw: ${error instanceof Error ? error.message : String(error)}`;
                wakeAll();
            },
        );
        const until = async (predicate: () => boolean, budgetMs = 15_000): Promise<void> => {
            const deadline = Date.now() + budgetMs;
            while (!predicate()) {
                if (finished !== undefined) {
                    throw new Error(finished);
                }
                const left = deadline - Date.now();
                if (left <= 0) {
                    throw new Error(`condition not met within ${String(budgetMs)} ms. Output so far:\n${out.join("")}`);
                }
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, left);
                    waiters.push(() => {
                        clearTimeout(timer);
                        resolve();
                    });
                });
            }
        };
        // Sync 1 is the initial rebuild. ctx.watch() starts a rebuild of its own whose sync is number 2; a change
        // written before it would be absorbed by that rebuild and prove nothing about the watchers.
        const settled = async (): Promise<void> => {
            await until(() => watching);
            await until(() => syncs >= 2);
        };
        const isDone = async (): Promise<boolean> => Promise.race([done.then(() => true), nextTick()]);
        const stop = async (): Promise<void> => {
            expect(await isDone()).toBe(false);
            controller.abort();
            expect(await done).toBe(0);
        };
        return { done, controller, out, settled, isDone, until, stop };
    }

    let handlesBefore = 0;
    beforeEach(() => {
        handlesBefore = statWatchers();
    });
    afterEach(() => {
        // Every run in this block has ended by now; none may leave a poller behind.
        expect(statWatchers()).toBe(handlesBefore);
    });

    it("rebuilds when a source file changes, then disposes cleanly on abort", { timeout: 30_000 }, async () => {
        const run = start();
        await run.settled();
        expect(inVault("main.js")).toContain('"first"');
        expect(statWatchers()).toBeGreaterThan(handlesBefore);

        writeFileSync(path.join(plugin.dir, "src/main.ts"), MAIN_TS("second"));
        await run.until(() => inVault("main.js").includes('"second"'));

        await run.stop();
        expect(run.out.join("")).toContain("watch stopped");
        expect(statWatchers()).toBe(handlesBefore);
    });

    it("rebuilds styles.css within the poll budget when a nested CSS import changes", { timeout: 30_000 }, async () => {
        const run = start();
        await run.settled();

        writeFileSync(path.join(plugin.dir, "src/styles/a.css"), ".a { color: blue; }\n");
        await run.until(() => inVault("styles.css").includes("blue"), POLL_BUDGET_MS);

        await run.stop();
    });

    it("rebuilds styles.css when the CSS entry itself changes", { timeout: 30_000 }, async () => {
        const run = start();
        await run.settled();

        writeFileSync(path.join(plugin.dir, "src/styles/main.css"), '@import "./a.css";\n.entry { color: green; }\n');
        await run.until(() => inVault("styles.css").includes("green"), POLL_BUDGET_MS);

        await run.stop();
    });

    it("starts polling an import added later and stops polling one that was removed", { timeout: 30_000 }, async () => {
        plugin.write("src/styles/b.css", ".b { color: red; }\n");
        const run = start();
        await run.settled();
        const polling = statWatchers();

        // Add b.css to the entry: one more file is polled afterwards, and a change to b.css reaches the vault.
        writeFileSync(path.join(plugin.dir, "src/styles/main.css"), '@import "./a.css";\n@import "./b.css";\n');
        await run.until(() => inVault("styles.css").includes(".b {"), POLL_BUDGET_MS);
        expect(statWatchers()).toBe(polling + 1);
        writeFileSync(path.join(plugin.dir, "src/styles/b.css"), ".b { color: purple; }\n");
        await run.until(() => inVault("styles.css").includes("purple"), POLL_BUDGET_MS);

        // Remove it again: back to the earlier count, and a change to b.css no longer rebuilds.
        writeFileSync(path.join(plugin.dir, "src/styles/main.css"), '@import "./a.css";\n');
        await run.until(() => !inVault("styles.css").includes(".b {"), POLL_BUDGET_MS);
        expect(statWatchers()).toBe(polling);

        await run.stop();
    });

    it("says once that CSS is not watched when the entry is missing at start", { timeout: 30_000 }, async () => {
        rmSync(path.join(plugin.dir, "src/styles"), { recursive: true });
        plugin.write("styles.css", ".root{}");
        const run = start();
        await run.settled();

        const lines = run.out.join("").split("\n").filter((line) => line.includes("CSS not watched"));
        expect(lines).toEqual(["! build   fixture-plugin: no src/styles/main.css, CSS not watched"]);
        // The manifest is the only polled file.
        expect(statWatchers()).toBe(handlesBefore + 1);

        await run.stop();
    });

    it("watches a root-level main.css entry whose default outfile is styles.css without looping", { timeout: 30_000 }, async () => {
        rmSync(path.join(plugin.dir, "src/styles"), { recursive: true });
        plugin.write("main.css", ".root-entry { color: red; }\n");
        const run = start({ build: resolveBuild({ css: { entry: "main.css" } }) });
        await run.settled();
        expect(inVault("styles.css")).toContain("root-entry");

        writeFileSync(path.join(plugin.dir, "main.css"), ".root-entry { color: teal; }\n");
        await run.until(() => inVault("styles.css").includes("teal"), POLL_BUDGET_MS);

        // Writing styles.css must not retrigger a rebuild: the output stays quiet while nothing changes.
        const quiet = run.out.length;
        await new Promise((resolve) => setTimeout(resolve, 3 * POLL_MS));
        expect(run.out.length).toBe(quiet);

        await run.stop();
    });

    it("copies manifest.json again when it changes, with no CSS to poll (Garmy layout)", { timeout: 30_000 }, async () => {
        // watchFile(manifest) is the only route here: no src/styles, and a manifest edit is not a source change.
        rmSync(path.join(plugin.dir, "src/styles"), { recursive: true });
        plugin.write("styles.css", ".root{}");
        const run = start();
        await run.settled();

        writeFileSync(
            path.join(plugin.dir, "manifest.json"),
            JSON.stringify({ id: "fixture-plugin", name: "Fixture", version: "2.0.0" }),
        );
        await run.until(() => inVault("manifest.json").includes("2.0.0"), POLL_BUDGET_MS);

        await run.stop();
    });

    it("keeps watching after a compile error and recovers when it is fixed", { timeout: 30_000 }, async () => {
        const run = start();
        await run.settled();

        writeFileSync(path.join(plugin.dir, "src/main.ts"), "export default class {");
        await run.until(() => run.out.join("").includes("build had 1 error(s)"));
        writeFileSync(path.join(plugin.dir, "src/main.ts"), MAIN_TS("fixed"));
        await run.until(() => inVault("main.js").includes('"fixed"'));

        await run.stop();
    });

    it("keeps polling the CSS entry after a failed CSS step, so the fix reaches the vault", { timeout: 30_000 }, async () => {
        plugin.write("src/styles/a.css", '@import "./gone.css";\n');
        const run = start();
        await run.settled();
        expect(run.out.join("")).toContain("CSS build or copy failed");

        writeFileSync(path.join(plugin.dir, "src/styles/a.css"), ".a { color: fixed; }\n");
        writeFileSync(path.join(plugin.dir, "src/styles/main.css"), '@import "./a.css";\n');
        await run.until(() => inVault("styles.css").includes("fixed"), POLL_BUDGET_MS);

        await run.stop();
    });

    it("watches sources when the plugin has no CSS folder (Garmy layout)", { timeout: 30_000 }, async () => {
        rmSync(path.join(plugin.dir, "src/styles"), { recursive: true });
        plugin.write("styles.css", ".root{}");
        const run = start();
        await run.settled();
        expect(inVault("styles.css")).toBe(".root{}");

        writeFileSync(path.join(plugin.dir, "src/main.ts"), MAIN_TS("garmy"));
        await run.until(() => inVault("main.js").includes('"garmy"'));

        await run.stop();
    });

    it("fails fast with the exit code when the watch returns early", { timeout: 30_000 }, async () => {
        writeFileSync(path.join(vault, "manifest.json"), JSON.stringify({ id: "other-plugin" }));
        const run = start();
        await expect(run.settled()).rejects.toThrow("watch returned early with exit 1");
    });

    it("needs a signal in watch mode", async () => {
        await expect(start({ signal: undefined }).done).rejects.toThrow("watch mode needs an AbortSignal");
    });

    it("refuses a vault folder that holds another plugin, also in watch mode", async () => {
        writeFileSync(path.join(vault, "manifest.json"), JSON.stringify({ id: "other-plugin" }));
        const run = start();
        expect(await run.done).toBe(1);
        expect(run.out.join("")).toContain("holds plugin other-plugin, not fixture-plugin");
        expect(inVault("main.js")).toBe("");
    });

    it("stops straight away when the signal is already aborted", { timeout: 30_000 }, async () => {
        const controller = new AbortController();
        controller.abort();
        const run = start({ signal: controller.signal });
        expect(await run.done).toBe(0);
        expect(inVault("main.js")).toContain("first");
    });

    it("wires Ctrl+C through the command context", { timeout: 30_000 }, async () => {
        let interrupt: () => void = () => undefined;
        let removed = false;
        const ctx = createContext(plugin.dir, {}, (listener) => {
            interrupt = listener;
            return () => {
                removed = true;
            };
        });
        const running = buildCommand.run(["--vault", vault, "--watch"], ctx);
        while (!ctx.out.join("").includes("Watching for changes")) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        const settledEarly = await Promise.race([running.then(() => true), nextTick()]);
        expect(settledEarly).toBe(false);
        expect(removed).toBe(false);
        interrupt();
        expect(await running).toBe(0);
        expect(removed).toBe(true);
    });
});

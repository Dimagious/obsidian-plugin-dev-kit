import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTempDir } from "../test-support/temp-registry.js";
import { testTmpRoot } from "../test-support/test-tmp.js";
import type { RunGit } from "./git.js";
import { createContext } from "../test-support/plugin-fixture.js";
import { createReleaseRepo, hermeticGitEnv, VALID_MANIFEST, type ReleaseRepo } from "../test-support/release-fixture.js";
import { ALL_CHECKS, runReleaseCheck, type CheckFlags } from "./check.js";
import { createRunGit } from "./git.js";
import { runRelease } from "./release.js";
import type { VersionSpec } from "./args.js";
import type { OpdkConfig } from "../config/types.js";
import { StepFailure } from "./publish-state.js";

// Real git, esbuild and a bare origin per test: they miss the 5 s default when suites share the machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const FAST: CheckFlags = { build: true, reproducible: false, api: false };
const TODAY = new Date(2026, 10, 11, 9, 30);

let repo: ReleaseRepo | undefined;
afterEach(() => {
    repo?.cleanup();
    repo = undefined;
});

function freshRepo(): ReleaseRepo {
    repo = createReleaseRepo();
    return repo;
}

interface Outcome {
    readonly code: number;
    readonly out: string;
    readonly err: string;
    readonly stdout: string;
}

async function release(current: ReleaseRepo, spec: VersionSpec, options: { dryRun?: boolean; flags?: CheckFlags; config?: OpdkConfig; test?: () => Promise<number> } = {}): Promise<Outcome> {
    const ctx = createContext(current.dir);
    const printed: string[] = [];
    const code = await runRelease({
        cwd: current.dir,
        spec,
        dryRun: options.dryRun ?? false,
        flags: options.flags ?? FAST,
        config: options.config ?? {},
        reporter: ctx.reporter,
        stdout: (text) => {
            printed.push(text);
        },
        run: current.run,
        now: () => TODAY,
        ...(options.test !== undefined && { test: options.test }),
    });
    return { code, out: ctx.out.join(""), err: ctx.err.join(""), stdout: printed.join("") };
}

const patch: VersionSpec = { kind: "bump", bump: "patch" };
const snapshot = (current: ReleaseRepo): Record<string, string> =>
    Object.fromEntries(
        ["package.json", "package-lock.json", "manifest.json", "versions.json", "CHANGELOG.md"].map((file) => [file, existsSync(path.join(current.dir, file)) ? current.read(file) : "(missing)"]),
    );

describe("opdk release patch", () => {
    it("bumps every file, moves the changelog, commits and tags, and pushes nothing", async () => {
        const current = freshRepo();
        const originMain = current.originGit("rev-parse", "main").trim();
        const result = await release(current, patch);

        expect(result.err).toBe("");
        expect(result.code).toBe(0);
        expect(JSON.parse(current.read("package.json"))).toEqual({ name: "fixture-release", version: "1.0.1", private: true, scripts: { build: "opdk build" } });
        const lock = JSON.parse(current.read("package-lock.json")) as { version: string; packages: Record<string, { version: string }> };
        expect([lock.version, lock.packages[""]?.version]).toEqual(["1.0.1", "1.0.1"]);
        expect(JSON.parse(current.read("manifest.json"))).toEqual({ ...VALID_MANIFEST, version: "1.0.1" });
        expect(JSON.parse(current.read("versions.json"))).toEqual({ "1.0.0": "1.5.0", "1.0.1": "1.5.0" });
        const changelog = current.read("CHANGELOG.md");
        expect(changelog).toContain("## [Unreleased]\n\n## [1.0.1] - 2026-11-11\n\n### Added\n\n- Word count in the status bar.\n\n## [1.0.0] - 2026-01-01");
        expect(changelog).toContain("[Unreleased]: https://github.com/example/fixture/compare/1.0.1...HEAD\n[1.0.1]: https://github.com/example/fixture/compare/1.0.0...1.0.1\n");

        expect(current.git("log", "-1", "--format=%s").trim()).toBe("chore(release): 1.0.1");
        expect(current.git("cat-file", "-t", "1.0.1").trim()).toBe("tag");
        expect(current.git("tag", "-l", "--format=%(contents:subject)", "1.0.1").trim()).toBe("1.0.1");
        expect(current.git("status", "--porcelain")).toBe("");
        expect(current.git("show", "--name-only", "--format=", "HEAD").trim().split("\n").sort()).toEqual(["CHANGELOG.md", "manifest.json", "package-lock.json", "package.json", "versions.json"]);

        // Nothing was pushed: origin has neither the tag nor the commit.
        expect(current.originGit("tag", "-l").trim()).toBe("1.0.0");
        expect(current.originGit("rev-parse", "main").trim()).toBe(originMain);
        expect(current.git("rev-list", "--count", "origin/main..main").trim()).toBe("1");

        expect(result.out).toContain("· bump    fixture-release: 1.0.0 -> 1.0.1\n");
        expect(result.out).toContain("✓ bump    manifest.json updated");
        expect(result.out).toContain("✓ check   fixture-release 1.0.1: ready to release.");
        expect(result.out).toContain('✓ git     committed "chore(release): 1.0.1" and created the annotated tag 1.0.1');
        expect(result.out).toContain("nothing was pushed (--no-push). Push the tag, wait for the workflow, verify and publish the release, then push the branch: `opdk release publish 1.0.1`");
    });

    it("supports minor, major and an exact version", async () => {
        const minor = freshRepo();
        expect((await release(minor, { kind: "bump", bump: "minor" })).code).toBe(0);
        expect(JSON.parse(minor.read("manifest.json"))).toMatchObject({ version: "1.1.0" });
        minor.cleanup();

        const major = freshRepo();
        expect((await release(major, { kind: "bump", bump: "major" })).code).toBe(0);
        expect(major.git("tag", "-l", "2.0.0").trim()).toBe("2.0.0");
        major.cleanup();

        const exact = freshRepo();
        expect((await release(exact, { kind: "exact", version: "1.4.2" })).code).toBe(0);
        expect(exact.git("log", "-1", "--format=%s").trim()).toBe("chore(release): 1.4.2");
    });

    it("runs the full check, builds twice, before it commits", async () => {
        const current = freshRepo();
        const result = await release(current, patch, { flags: { build: true, reproducible: true, api: false } });
        expect(result.code).toBe(0);
        expect(result.out).toContain("✓ check   reproducible:");
    });

    it("creates versions.json for a plugin that has none", async () => {
        const current = freshRepo();
        current.git("rm", "--quiet", "versions.json");
        current.commitAll("drop versions.json");
        const result = await release(current, patch);
        expect(result.code).toBe(0);
        expect(result.out).toContain("✓ bump    versions.json created");
        expect(JSON.parse(current.read("versions.json"))).toEqual({ "1.0.1": "1.5.0" });
        expect(current.git("show", "--name-only", "--format=", "HEAD")).toContain("versions.json");
    });

    it("cuts a release from a default branch named in the config", async () => {
        const current = freshRepo();
        current.git("config", "remote.origin.followRemoteHEAD", "never");
        current.git("remote", "set-head", "origin", "--delete");
        expect((await release(current, patch)).err).toContain("origin/HEAD is not set");
        const result = await release(current, patch, { config: { release: { defaultBranch: "main" } } });
        expect(result.code).toBe(0);
    });

    it("refuses commits origin has not seen: nothing ran CI on them", async () => {
        const current = freshRepo();
        current.write("note.txt", "x");
        current.git("add", "-A");
        current.git("commit", "--quiet", "-m", "local work");
        const before = snapshot(current);
        const head = current.git("rev-parse", "HEAD");
        const result = await release(current, patch);
        expect(result.code).toBe(1);
        expect(result.err).toContain("✗ git     main is 1 commit(s) ahead of origin/main: CI has not seen them, and the release would tag them.");
        expect(result.err).toContain("Push them through a pull request first");
        expect(snapshot(current)).toEqual(before);
        expect(current.git("rev-parse", "HEAD")).toBe(head);
        expect(current.git("tag", "-l")).toBe("1.0.0\n");
    });
});

describe("the plugin's tests before the release", () => {
    function withTestScript(current: ReleaseRepo): void {
        current.write("package.json", `${JSON.stringify({ name: "fixture-release", version: "1.0.0", private: true, scripts: { build: "opdk build", test: "vitest run" } }, null, 2)}\n`);
        current.commitAll("add a test script");
    }

    it("runs them on the tree as it is, before any file changes, and goes on when they pass", async () => {
        const current = freshRepo();
        withTestScript(current);
        const seen: string[] = [];
        const result = await release(current, patch, {
            test: () => {
                seen.push(current.read("manifest.json").includes('"version": "1.0.0"') ? "1.0.0" : "changed", current.git("status", "--porcelain"));
                return Promise.resolve(0);
            },
        });
        expect(result.code).toBe(0);
        expect(seen).toEqual(["1.0.0", ""]);
        expect(result.out).toContain("✓ test    npm test passed");
        expect(current.git("tag", "-l")).toContain("1.0.1");
    });

    it("stops on a failing run with nothing changed, no commit and no tag", async () => {
        const current = freshRepo();
        withTestScript(current);
        const before = snapshot(current);
        const head = current.git("rev-parse", "HEAD");
        const result = await release(current, patch, { test: () => Promise.resolve(2) });
        expect(result.code).toBe(1);
        expect(result.err).toContain("✗ test    npm test failed (exit 2). Nothing was changed.");
        expect(snapshot(current)).toEqual(before);
        expect(current.git("rev-parse", "HEAD")).toBe(head);
        expect(current.git("tag", "-l")).toBe("1.0.0\n");
    });

    it("runs them in a dry run too, so a red suite shows before release day", async () => {
        const current = freshRepo();
        withTestScript(current);
        const calls: number[] = [];
        const result = await release(current, patch, {
            dryRun: true,
            test: () => {
                calls.push(1);
                return Promise.resolve(1);
            },
        });
        expect(calls).toHaveLength(1);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe("");
    });

    it("warns instead of failing when package.json has no test script", async () => {
        const current = freshRepo();
        const calls: number[] = [];
        const result = await release(current, patch, {
            test: () => {
                calls.push(1);
                return Promise.resolve(1);
            },
        });
        expect(calls).toEqual([]);
        expect(result.code).toBe(0);
        expect(result.out).toContain('! test    package.json has no "test" script, so no tests ran before the release.');
    });

    it("runs nothing without a test runner (--no-test)", async () => {
        const current = freshRepo();
        withTestScript(current);
        const result = await release(current, patch);
        expect(result.code).toBe(0);
        expect(result.out).not.toContain("test ");
    });
});

describe("opdk release --dry-run", () => {
    it("shows the diff, restores every file byte for byte and writes nothing to git", async () => {
        const current = freshRepo();
        const before = snapshot(current);
        const head = current.git("rev-parse", "HEAD");
        const result = await release(current, patch, { dryRun: true });

        expect(result.code).toBe(0);
        expect(snapshot(current)).toEqual(before);
        expect(current.git("rev-parse", "HEAD")).toBe(head);
        expect(current.git("tag", "-l")).toBe("1.0.0\n");
        expect(current.git("status", "--porcelain")).toBe("");
        expect(current.originGit("tag", "-l")).toBe("1.0.0\n");

        expect(result.stdout).toContain('-  "version": "1.0.0"');
        expect(result.stdout).toContain('+  "version": "1.0.1"');
        expect(result.stdout).toContain('+  "1.0.1": "1.5.0"');
        expect(result.stdout).toContain("+## [1.0.1] - 2026-11-11");
        expect(result.out).toContain("(dry run)");
        expect(result.out).toContain('dry run: nothing was written, the files are restored. Without --dry-run opdk commits "chore(release): 1.0.1" and tags 1.0.1.');
        expect(result.out).not.toContain("committed");
    });

    it("shows a new versions.json whole and removes it again", async () => {
        const current = freshRepo();
        current.git("rm", "--quiet", "versions.json");
        current.commitAll("drop versions.json");
        const result = await release(current, patch, { dryRun: true });
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('new file versions.json\n+{\n+  "1.0.1": "1.5.0"\n+}');
        expect(current.git("status", "--porcelain")).toBe("");
    });
});

describe("preflight failures leave everything as it was", () => {
    async function refuses(current: ReleaseRepo, spec: VersionSpec, message: string, options: { dryRun?: boolean } = {}): Promise<Outcome> {
        const before = snapshot(current);
        const head = current.git("rev-parse", "HEAD");
        const tags = current.git("tag", "-l");
        const result = await release(current, spec, options);
        expect(result.code).toBe(1);
        expect(result.err).toContain(message);
        expect(snapshot(current)).toEqual(before);
        expect(current.git("rev-parse", "HEAD")).toBe(head);
        expect(current.git("tag", "-l")).toBe(tags);
        return result;
    }

    it("refuses a dirty tree, naming the file", async () => {
        const current = freshRepo();
        current.write("src/main.ts", "export default class Changed {}\n");
        current.write("stray.txt", "x");
        const result = await refuses(current, patch, "✗ git     the working tree is not clean ( M src/main.ts, ?? stray.txt).");
        expect(result.err).toContain("Commit or discard the changes first");
    });

    it("refuses another branch", async () => {
        const current = freshRepo();
        current.git("switch", "--quiet", "-c", "feat/x");
        await refuses(current, patch, "releases are cut from main, but this is feat/x.");
    });

    it("refuses when behind origin", async () => {
        const current = freshRepo();
        current.write("a.txt", "a");
        current.commitAll("ahead");
        current.git("reset", "--quiet", "--hard", "HEAD~1");
        await refuses(current, patch, "main is 1 commit(s) behind origin/main.");
    });

    it("refuses a tag that exists on origin only, and one that exists locally", async () => {
        const remoteOnly = freshRepo();
        remoteOnly.originGit("tag", "1.0.1", "main");
        await refuses(remoteOnly, patch, "the tag 1.0.1 already exists");
        remoteOnly.cleanup();

        const local = freshRepo();
        local.git("tag", "1.0.1");
        await refuses(local, patch, "the tag 1.0.1 already exists locally.");
    });

    it("refuses a version that is not higher than the current one", async () => {
        const current = freshRepo();
        await refuses(current, { kind: "exact", version: "1.0.0" }, "the tag 1.0.0 already exists locally.");
        // With the tag gone locally and on origin, only the version comparison is left to refuse the current version.
        current.git("tag", "-d", "1.0.0");
        current.originGit("tag", "-d", "1.0.0");
        await refuses(current, { kind: "exact", version: "1.0.0" }, "1.0.0 is not higher than the current version 1.0.0.");
        await refuses(current, { kind: "exact", version: "0.9.0" }, "0.9.0 is not higher than the current version 1.0.0.");
    });

    it("refuses an [Unreleased] section without entries, and a missing changelog", async () => {
        const empty = freshRepo();
        empty.write("CHANGELOG.md", "# Changelog\n\n## [Unreleased]\n\n### Added\n\n## [1.0.0] - 2026-01-01\n\n- First.\n");
        empty.commitAll("empty unreleased");
        await refuses(empty, patch, 'the "## [Unreleased]" section of CHANGELOG.md has no entries.');
        empty.cleanup();

        const missing = freshRepo();
        missing.git("rm", "--quiet", "CHANGELOG.md");
        missing.commitAll("drop changelog");
        await refuses(missing, patch, "CHANGELOG.md is missing.");
    });

    it("refuses versions that disagree before the bump", async () => {
        const current = freshRepo();
        current.write("package.json", JSON.stringify({ name: "fixture-release", version: "0.9.0" }, null, 2));
        current.commitAll("drift");
        const result = await refuses(current, patch, "the versions disagree before the bump");
        expect(result.err).toContain("package.json is 0.9.0 but manifest.json is 1.0.0.");
    });

    it("refuses when versions.json already maps the new version to another minAppVersion", async () => {
        const current = freshRepo();
        current.write("versions.json", `${JSON.stringify({ "1.0.0": "1.5.0", "1.0.1": "1.4.0" }, null, 2)}\n`);
        current.commitAll("versions");
        await refuses(current, patch, "versions.json already maps 1.0.1 to 1.4.0, but manifest.json minAppVersion is 1.5.0.");
    });

    it("refuses a folder that is not a git repository", async () => {
        const current = freshRepo();
        current.write("../outside/manifest.json", JSON.stringify(VALID_MANIFEST));
        const ctx = createContext(path.join(current.dir, "..", "outside"));
        const result = await runRelease({
            cwd: ctx.cwd,
            spec: patch,
            dryRun: false,
            flags: FAST,
            config: {},
            reporter: ctx.reporter,
            stdout: () => undefined,
            run: createRunGit(ctx.cwd, hermeticGitEnv()),
            now: () => TODAY,
        });
        expect(result).toBe(1);
    });

    it("refuses a plugin whose manifest.json cannot be read", async () => {
        const current = freshRepo();
        current.write("manifest.json", "{nope");
        const ctx = createContext(current.dir);
        const code = await runRelease({ cwd: current.dir, spec: patch, dryRun: false, flags: FAST, config: {}, reporter: ctx.reporter, stdout: () => undefined, run: current.run, now: () => TODAY });
        expect(code).toBe(1);
        expect(ctx.err.join("")).toContain("manifest.json is missing, not valid or has no version.");
    });
});

describe("when the release check fails on the bumped files", () => {
    it("restores the files and commits nothing", async () => {
        const current = freshRepo();
        // Valid for the bump, but a manifest rule the check enforces: the name may not say "Obsidian".
        current.write("manifest.json", `${JSON.stringify({ ...VALID_MANIFEST, name: "Obsidian Words" }, null, 2)}\n`);
        current.commitAll("bad name");
        const before = snapshot(current);
        const head = current.git("rev-parse", "HEAD");
        const result = await release(current, patch);
        expect(result.code).toBe(1);
        expect(result.err).toContain('manifest: manifest.json: name "Obsidian Words" must not contain "obsidian".');
        expect(result.err).toContain("the release check failed on the bumped files. Nothing was committed and the files are restored.");
        expect(snapshot(current)).toEqual(before);
        expect(current.git("rev-parse", "HEAD")).toBe(head);
        expect(current.git("tag", "-l")).toBe("1.0.0\n");
        expect(current.git("status", "--porcelain")).toBe("");
    });
});

describe("when git refuses the commit", () => {
    it("keeps the bumped files and says how to finish by hand", async () => {
        const current = freshRepo();
        const hook = path.join(current.dir, ".git/hooks/pre-commit");
        writeFileSync(hook, "#!/bin/sh\necho 'no commits today' >&2\nexit 1\n");
        chmodSync(hook, 0o755);
        const ctx = createContext(current.dir);
        await expect(
            runRelease({ cwd: current.dir, spec: patch, dryRun: false, flags: FAST, config: {}, reporter: ctx.reporter, stdout: () => undefined, run: current.run, now: () => TODAY }),
        ).rejects.toThrow(/git commit --quiet -m chore\(release\): 1\.0\.1 failed: .*no commits today[\s\S]*bumped files stay in the working tree/);
        expect(JSON.parse(current.read("manifest.json"))).toMatchObject({ version: "1.0.1" });
        expect(current.git("tag", "-l")).toBe("1.0.0\n");
    });
});

describe("Ctrl+C during the release check", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    interface Interrupted {
        readonly tmp: string;
        readonly exits: number[];
        readonly removed: string[];
        /** What the temp folder and the five files looked like at the moment the listener returned, before anything else ran. */
        readonly atInterrupt: { readonly files: Record<string, string>; readonly buildFolders: string[] };
        readonly midFlight: { readonly buildFolders: string[] };
        readonly hooks: { readonly onInterrupt: (listener: () => void) => () => void; readonly exit: (code: number) => void };
        readonly run: RunGit;
    }

    /** Presses Ctrl+C when the check asks git to archive the committed tree: the first build is done, its folders exist. */
    function interruptAtArchive(current: ReleaseRepo): Interrupted {
        const tmp = mkdtempSync(path.join(testTmpRoot(), "opdk-release-sigint-"));
        registerTempDir(tmp);
        mkdirSync(path.join(tmp, "unused"));
        vi.stubEnv("TMPDIR", tmp);
        const listeners: (() => void)[] = [];
        const exits: number[] = [];
        const removed: string[] = [];
        const state = { atInterrupt: { files: {} as Record<string, string>, buildFolders: [] as string[] }, midFlight: { buildFolders: [] as string[] } };
        const buildFolders = (): string[] => readdirSync(tmp).filter((name) => name.startsWith("opdk-release-"));
        const run: RunGit = async (args) => {
            if (args[0] === "archive") {
                state.midFlight = { buildFolders: buildFolders() };
                for (const listener of listeners) {
                    listener();
                }
                state.atInterrupt = { files: snapshot(current), buildFolders: buildFolders() };
            }
            return current.run(args);
        };
        return {
            tmp,
            exits,
            removed,
            get atInterrupt() {
                return state.atInterrupt;
            },
            get midFlight() {
                return state.midFlight;
            },
            hooks: {
                onInterrupt: (listener) => {
                    listeners.push(listener);
                    return () => {
                        removed.push("listener");
                        listeners.splice(listeners.indexOf(listener), 1);
                    };
                },
                exit: (code) => {
                    exits.push(code);
                },
            },
            run,
        };
    }

    const FULL: CheckFlags = { build: true, reproducible: true, api: false };

    it("restores the five files and removes the build folders before it exits with 130", async () => {
        const current = freshRepo();
        const before = snapshot(current);
        const sigint = interruptAtArchive(current);
        const ctx = createContext(current.dir);
        const code = await runRelease({ cwd: current.dir, spec: patch, dryRun: true, flags: FULL, config: {}, reporter: ctx.reporter, stdout: () => undefined, run: sigint.run, interrupt: sigint.hooks, now: () => TODAY });

        expect(sigint.midFlight.buildFolders.length).toBeGreaterThan(0);
        expect(sigint.atInterrupt.files).toEqual(before);
        expect(sigint.atInterrupt.buildFolders).toEqual([]);
        expect(sigint.exits).toEqual([130]);
        expect(code).toBe(130);
        expect(snapshot(current)).toEqual(before);
        expect(readdirSync(sigint.tmp).filter((name) => name.startsWith("opdk-release-"))).toEqual([]);
        expect(current.git("status", "--porcelain")).toBe("");
        expect(current.git("tag", "-l")).toBe("1.0.0\n");
        expect(sigint.removed).toEqual(["listener"]);
        expect(ctx.out.join("")).toContain("interrupted: restoring the files and removing the temp folders");
    });

    it("also cleans up a real (not dry) release that is interrupted before the commit", async () => {
        const current = freshRepo();
        const before = snapshot(current);
        const head = current.git("rev-parse", "HEAD");
        const sigint = interruptAtArchive(current);
        const ctx = createContext(current.dir);
        const code = await runRelease({ cwd: current.dir, spec: patch, dryRun: false, flags: FULL, config: {}, reporter: ctx.reporter, stdout: () => undefined, run: sigint.run, interrupt: sigint.hooks, now: () => TODAY });
        expect(code).toBe(130);
        expect(snapshot(current)).toEqual(before);
        expect(current.git("rev-parse", "HEAD")).toBe(head);
        expect(current.git("tag", "-l")).toBe("1.0.0\n");
    });

    it("removes the build folders when `release check` alone is interrupted", async () => {
        const current = freshRepo();
        const sigint = interruptAtArchive(current);
        const ctx = createContext(current.dir);
        await runReleaseCheck({ cwd: current.dir, config: {}, tag: undefined, flags: FULL, reporter: ctx.reporter, run: sigint.run, interrupt: sigint.hooks });
        expect(sigint.midFlight.buildFolders.length).toBeGreaterThan(0);
        expect(sigint.atInterrupt.buildFolders).toEqual([]);
        expect(sigint.exits).toEqual([130]);
        expect(readdirSync(sigint.tmp).filter((name) => name.startsWith("opdk-release-"))).toEqual([]);
        expect(sigint.removed).toEqual(["listener"]);
    });

    it("tells how to finish by hand when Ctrl+C arrives while git commits, and unregisters that listener after the tag", async () => {
        const current = freshRepo();
        const listeners: (() => void)[] = [];
        const exits: number[] = [];
        let registered = 0;
        const hooks = {
            onInterrupt: (listener: () => void) => {
                registered++;
                listeners.push(listener);
                return () => {
                    listeners.splice(listeners.indexOf(listener), 1);
                };
            },
            exit: (code: number) => {
                exits.push(code);
            },
        };
        const run: RunGit = (args) => {
            if (args[0] === "commit") {
                // Only the commit-window listener is left: the restoring one is gone.
                expect(listeners).toHaveLength(1);
                for (const listener of [...listeners]) {
                    listener();
                }
            }
            return current.run(args);
        };
        const ctx = createContext(current.dir);
        const code = await runRelease({ cwd: current.dir, spec: patch, dryRun: false, flags: FAST, config: {}, reporter: ctx.reporter, stdout: () => undefined, run, interrupt: hooks, now: () => TODAY });
        expect(code).toBe(0);
        expect(registered).toBe(2);
        expect(exits).toEqual([130]);
        expect(ctx.err.join("")).toContain("interrupted while committing: finish the commit and the tag by hand (git commit, git tag -a 1.0.1 -m 1.0.1), or restore with git");
        expect(listeners).toEqual([]);
    });

    it("unregisters the listener (the guard's and the commit window's) once each after a normal run", async () => {
        const current = freshRepo();
        const sigint = interruptAtArchive(current);
        const ctx = createContext(current.dir);
        const code = await runRelease({ cwd: current.dir, spec: patch, dryRun: false, flags: FAST, config: {}, reporter: ctx.reporter, stdout: () => undefined, run: current.run, interrupt: sigint.hooks, now: () => TODAY });
        expect(code).toBe(0);
        expect(sigint.removed).toEqual(["listener", "listener"]);
        expect(sigint.exits).toEqual([]);
    });
});

describe("the default flags", () => {
    it("run every check", () => {
        expect(ALL_CHECKS).toEqual({ build: true, reproducible: true, api: true });
    });
});

describe("the push flow after the tag", () => {
    const flags = FAST;

    function withPush(current: ReleaseRepo, push: NonNullable<Parameters<typeof runRelease>[0]["push"]>, options: { dryRun?: boolean } = {}): Promise<number> {
        const ctx = createContext(current.dir);
        return runRelease({ cwd: current.dir, spec: patch, dryRun: options.dryRun ?? false, flags, config: {}, reporter: ctx.reporter, stdout: () => undefined, run: current.run, now: () => TODAY, push });
    }

    it("hands the version to the flow after the commit and the tag, and returns its exit code", async () => {
        const current = freshRepo();
        const publish = vi.fn((version: string) => {
            // By now the commit and the annotated tag exist locally; nothing has reached origin.
            expect(current.git("cat-file", "-t", version).trim()).toBe("tag");
            expect(current.originGit("tag", "-l").trim()).toBe("1.0.0");
            return Promise.resolve(7);
        });
        const ready = vi.fn(() => Promise.resolve());
        expect(await withPush(current, { ready, publish })).toBe(7);
        expect(ready).toHaveBeenCalledOnce();
        expect(publish).toHaveBeenCalledWith("1.0.1");
    });

    it("stops before bumping anything when gh is not ready, and says how to stop at the tag", async () => {
        const current = freshRepo();
        const before = snapshot(current);
        const ctx = createContext(current.dir);
        const code = await runRelease({
            cwd: current.dir,
            spec: patch,
            dryRun: false,
            flags,
            config: {},
            reporter: ctx.reporter,
            stdout: () => undefined,
            run: current.run,
            now: () => TODAY,
            push: { ready: () => Promise.reject(new StepFailure("the GitHub CLI (gh) is not installed.", "Install it.")), publish: () => Promise.resolve(0) },
        });
        expect(code).toBe(1);
        expect(ctx.err.join("")).toContain("✗ gh      the GitHub CLI (gh) is not installed.");
        expect(ctx.err.join("")).toContain("Install it. Nothing was changed. Use --no-push to stop at the local tag.");
        expect(snapshot(current)).toEqual(before);
        expect(current.git("tag", "-l")).toBe("1.0.0\n");
    });

    it("does not check gh on a dry run and does not publish", async () => {
        const current = freshRepo();
        const ready = vi.fn(() => Promise.resolve());
        const publish = vi.fn(() => Promise.resolve(0));
        expect(await withPush(current, { ready, publish }, { dryRun: true })).toBe(0);
        expect(ready).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it("passes an unexpected error from the readiness check on", async () => {
        const current = freshRepo();
        await expect(withPush(current, { ready: () => Promise.reject(new Error("disk on fire")), publish: () => Promise.resolve(0) })).rejects.toThrow("disk on fire");
    });
});

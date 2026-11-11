import { afterEach, describe, expect, it } from "vitest";
import { createReleaseRepo, hermeticGitEnv, type ReleaseRepo } from "../test-support/release-fixture.js";
import { collectFacts, createRunGit, repositoryFreeEnvironment } from "./git.js";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { testTmpRoot } from "../test-support/test-tmp.js";

let repo: ReleaseRepo | undefined;
afterEach(() => {
    repo?.cleanup();
    repo = undefined;
});

const facts = async (version: string, override?: string) => {
    const current = repo ?? createReleaseRepo();
    repo = current;
    return collectFacts({ run: current.run, version, defaultBranchOverride: override });
};

describe("collectFacts", () => {
    it("reads a clean checkout of main that is level with origin", async () => {
        expect(await facts("1.1.0")).toEqual({
            insideRepo: true,
            dirty: [],
            branch: "main",
            defaultBranch: "main",
            hasOrigin: true,
            fetchError: undefined,
            behind: 0,
            ahead: 0,
            localTag: false,
            remoteTag: "absent",
            remoteTagError: undefined,
        });
    });

    it("sees the existing tag locally and on origin", async () => {
        const found = await facts("1.0.0");
        expect(found.localTag).toBe(true);
        expect(found.remoteTag).toBe("present");
    });

    it("sees a tag that exists only on origin, and one that exists only locally", async () => {
        const current = createReleaseRepo();
        repo = current;
        current.originGit("tag", "9.0.0", "main");
        current.git("tag", "8.0.0");
        const run = current.run;
        expect(await collectFacts({ run, version: "9.0.0", defaultBranchOverride: undefined })).toMatchObject({ localTag: false, remoteTag: "present" });
        expect(await collectFacts({ run, version: "8.0.0", defaultBranchOverride: undefined })).toMatchObject({ localTag: true, remoteTag: "absent" });
    });

    it("lists changed and untracked files", async () => {
        const current = createReleaseRepo();
        repo = current;
        current.write("manifest.json", "{}");
        current.write("new.txt", "x");
        const found = await collectFacts({ run: current.run, version: "1.1.0", defaultBranchOverride: undefined });
        expect(found.dirty).toEqual([" M manifest.json", "?? new.txt"]);
    });

    it("counts commits ahead of and behind origin after fetching", async () => {
        const current = createReleaseRepo();
        repo = current;
        current.write("a.txt", "a");
        current.git("add", "-A");
        current.git("commit", "--quiet", "-m", "local");
        // Another clone pushes a commit this checkout has not seen: only the fetch inside collectFacts reveals it.
        const other = path.join(path.dirname(current.dir), "other");
        current.git("clone", "--quiet", current.origin, other);
        current.git("-C", other, "config", "user.name", "Other");
        current.git("-C", other, "config", "commit.gpgsign", "false");
        current.git("-C", other, "config", "user.email", "other@example.com");
        current.git("-C", other, "commit", "--quiet", "--allow-empty", "-m", "remote");
        current.git("-C", other, "push", "--quiet", "origin", "main");
        const found = await collectFacts({ run: current.run, version: "1.1.0", defaultBranchOverride: undefined });
        expect(found).toMatchObject({ ahead: 1, behind: 1 });
    });

    it("uses the configured default branch before origin/HEAD, and reports a branch origin lacks", async () => {
        const found = await facts("1.1.0", "trunk");
        expect(found.defaultBranch).toBe("trunk");
        expect(found.behind).toBeUndefined();
    });

    it("has no default branch when origin/HEAD is not set", async () => {
        const current = createReleaseRepo();
        repo = current;
        // Since git 2.48 a fetch sets origin/HEAD again unless told not to.
        current.git("config", "remote.origin.followRemoteHEAD", "never");
        current.git("remote", "set-head", "origin", "--delete");
        const found = await collectFacts({ run: current.run, version: "1.1.0", defaultBranchOverride: undefined });
        expect(found.defaultBranch).toBeUndefined();
    });

    it("reports an origin that cannot be reached, for the fetch and for the tag lookup", async () => {
        const current = createReleaseRepo();
        repo = current;
        current.git("remote", "set-url", "origin", path.join(path.dirname(current.dir), "gone.git"));
        const found = await collectFacts({ run: current.run, version: "1.1.0", defaultBranchOverride: undefined });
        expect(found.fetchError).toContain("git fetch");
        expect(found.fetchError).toContain("origin");
        expect(found.remoteTag).toBe("unreachable");
        expect(found.remoteTagError).toContain("git ls-remote");
    });

    it("sees a repository without origin, and a detached HEAD", async () => {
        const current = createReleaseRepo();
        repo = current;
        current.git("remote", "remove", "origin");
        current.git("checkout", "--quiet", "--detach");
        const found = await collectFacts({ run: current.run, version: "1.1.0", defaultBranchOverride: undefined });
        expect(found).toMatchObject({ hasOrigin: false, branch: undefined, defaultBranch: undefined });
    });

    it("says it is not inside a repository for a plain folder", async () => {
        const dir = mkdtempSync(path.join(testTmpRoot(), "opdk-release-nogit-"));
        try {
            const found = await collectFacts({ run: createRunGit(dir, hermeticGitEnv()), version: "1.1.0", defaultBranchOverride: undefined });
            expect(found.insideRepo).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("repositoryFreeEnvironment", () => {
    it("drops the variables that locate a repository and keeps the rest", () => {
        const env = {
            GIT_DIR: "/a",
            GIT_WORK_TREE: "/b",
            GIT_INDEX_FILE: "/c",
            GIT_OBJECT_DIRECTORY: "/d",
            GIT_ALTERNATE_OBJECT_DIRECTORIES: "/e",
            GIT_COMMON_DIR: "/f",
            GIT_PREFIX: "sub/",
            GIT_SSH_COMMAND: "ssh -i key",
            GIT_ASKPASS: "/bin/askpass",
            GIT_CONFIG_GLOBAL: "/dev/null",
            HOME: "/home/x",
        };
        expect(repositoryFreeEnvironment(env)).toEqual({ GIT_SSH_COMMAND: "ssh -i key", GIT_ASKPASS: "/bin/askpass", GIT_CONFIG_GLOBAL: "/dev/null", HOME: "/home/x" });
    });
});

describe("createRunGit and the remote", () => {
    // A stand-in for ssh: records what git handed it, then says what git says when it needs a password it may not ask for.
    function fakeSsh(dir: string): { command: string; log: string } {
        const log = path.join(dir, "ssh.log");
        const script = path.join(dir, "fake-ssh.sh");
        writeFileSync(script, `#!/bin/sh\nprintf '%s' "$GIT_TERMINAL_PROMPT" > "${log}"\necho "fatal: could not read Username for 'https://example.com': terminal prompts disabled" >&2\nexit 1\n`);
        chmodSync(script, 0o755);
        return { command: script, log };
    }

    it("keeps GIT_SSH_COMMAND, turns prompts off for fetch and says what to do about credentials", async () => {
        const current = createReleaseRepo();
        repo = current;
        const ssh = fakeSsh(path.dirname(current.dir));
        current.git("remote", "set-url", "origin", "ssh://git@example.invalid/plugin.git");
        const run = createRunGit(current.dir, { ...hermeticGitEnv(), GIT_SSH_COMMAND: ssh.command, GIT_TERMINAL_PROMPT: "1" });
        await expect(run(["fetch", "--quiet", "origin"])).rejects.toThrow(/terminal prompts disabled[\s\S]*never waits for a prompt\. Sign in first/);
        expect(readFileSync(ssh.log, "utf8")).toBe("0");
        await expect(run(["ls-remote", "--tags", "origin"])).rejects.toThrow(/never waits for a prompt/);
    });
});

describe("createRunGit", () => {
    it("names the command and git's message when git fails", async () => {
        const current = createReleaseRepo();
        repo = current;
        await expect(current.run(["rev-parse", "--verify", "nope"])).rejects.toThrow(/^git rev-parse --verify nope failed: /);
    });

    it("ignores GIT_DIR from the environment", async () => {
        const current = createReleaseRepo();
        repo = current;
        const run = createRunGit(current.dir, { ...hermeticGitEnv(), GIT_DIR: current.origin });
        expect((await run(["rev-parse", "--is-inside-work-tree"])).trim()).toBe("true");
    });
});

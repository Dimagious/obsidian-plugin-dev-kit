import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, type CapturedContext } from "../test-support/plugin-fixture.js";
import { FakeGithub, fakeClock } from "../test-support/fake-github.js";
import { createReleaseRepo, hermeticGitEnv, type ReleaseRepo } from "../test-support/release-fixture.js";
import type { TaggedBuild } from "./build-tagged.js";
import type { RunGit } from "./git.js";
import { runPublish, type PublishInput } from "./publish.js";
import { runRelease } from "./release.js";

// Real git with a bare origin per test.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const MAIN = Buffer.from("console.log('main');\n");
const CSS = Buffer.from(".fixture { color: red; }\n");
const SLUG = "example/fixture";

interface Scenario {
    readonly repo: ReleaseRepo;
    readonly github: FakeGithub;
    readonly ctx: CapturedContext;
    readonly clock: ReturnType<typeof fakeClock>;
    readonly gitCalls: string[][];
    readonly commit: string;
    readonly manifest: Buffer;
    readonly tmp: string;
    input(overrides?: Partial<PublishInput>): PublishInput;
}

let repo: ReleaseRepo | undefined;
let tmp: string;
const savedTmpdir = process.env.TMPDIR;

beforeEach(() => {
    // The flow makes its temp folders under os.tmpdir(): point that at a folder of this test so leaks are visible.
    tmp = mkdtempSync(path.join(tmpdir(), "opdk-publish-test-"));
    process.env.TMPDIR = tmp;
});

afterEach(() => {
    repo?.cleanup();
    repo = undefined;
    if (savedTmpdir === undefined) {
        delete process.env.TMPDIR;
    } else {
        process.env.TMPDIR = savedTmpdir;
    }
    rmSync(tmp, { recursive: true, force: true });
});

/** A plugin released locally as 1.0.1 (commit and tag, nothing pushed) whose origin is known by its GitHub URL. */
async function scenario(): Promise<Scenario> {
    repo = createReleaseRepo();
    const current = repo;
    const ctx = createContext(current.dir);
    const code = await runRelease({
        cwd: current.dir,
        spec: { kind: "bump", bump: "patch" },
        dryRun: false,
        flags: { build: false, reproducible: false, api: false },
        config: {},
        reporter: ctx.reporter,
        stdout: () => undefined,
        run: current.run,
        now: () => new Date(2026, 10, 11),
    });
    expect(code).toBe(0);
    // `git remote get-url` expands insteadOf, `git config` does not: the flow reads the GitHub URL and pushes to the bare repository.
    current.git("config", "remote.origin.url", `https://github.com/${SLUG}.git`);
    current.git("config", `url.${current.origin}.insteadOf`, `https://github.com/${SLUG}.git`);

    const commit = current.git("rev-parse", "1.0.1^{commit}").trim();
    const manifest = Buffer.from(current.git("show", "1.0.1:manifest.json"));
    const github = new FakeGithub(SLUG, "1.0.1");
    github.runs = [{ databaseId: 42, status: "completed", conclusion: "success", event: "push", headSha: commit, url: `https://github.com/${SLUG}/actions/runs/42`, workflowName: "Release", createdAt: "2026-11-11T10:00:00Z" }];
    github.release = {
        draft: true,
        assets: [
            { name: "main.js", bytes: MAIN },
            { name: "manifest.json", bytes: manifest },
            { name: "styles.css", bytes: CSS },
        ],
    };
    const publishCtx = createContext(current.dir);
    const gitCalls: string[][] = [];
    const run: RunGit = (args) => {
        gitCalls.push([...args]);
        return current.run(args);
    };
    const clock = fakeClock();
    const build: TaggedBuild = { commit: commit.slice(0, 7), mainJs: MAIN, css: CSS, manifest };
    return {
        repo: current,
        github,
        ctx: publishCtx,
        clock,
        gitCalls,
        commit,
        manifest,
        tmp,
        input: (overrides = {}) => ({
            version: "1.0.1",
            reporter: publishCtx.reporter,
            run,
            gh: github,
            defaultBranch: undefined,
            buildTagged: () => Promise.resolve(build),
            zip: false,
            timeoutMs: 20 * 60_000,
            appearMs: 3 * 60_000,
            pollMs: 10_000,
            clock,
            ...overrides,
        }),
    };
}

const remoteTags = (current: ReleaseRepo): string[] => current.originGit("tag", "-l").trim().split("\n");
const leftovers = (): string[] => readdirSync(tmp).filter((name) => name.startsWith("opdk-release"));

describe("runPublish", () => {
    it("pushes the tag, waits, verifies, publishes and only then pushes the branch", async () => {
        const s = await scenario();
        const originMain = s.repo.originGit("rev-parse", "main").trim();
        const seenAtPublish: { tags: string[]; main: string }[] = [];
        const github = s.github;
        const text = github.text.bind(github);
        github.text = (args) => {
            if (args[0] === "release" && args[1] === "edit") {
                seenAtPublish.push({ tags: remoteTags(s.repo), main: s.repo.originGit("rev-parse", "main").trim() });
            }
            return text(args);
        };

        const code = await runPublish(s.input());

        expect(s.ctx.err.join("")).toBe("");
        expect(code).toBe(0);
        // At the moment of publishing the tag is on origin and the branch is not.
        expect(seenAtPublish).toEqual([{ tags: ["1.0.0", "1.0.1"], main: originMain }]);
        expect(s.repo.originGit("rev-parse", "main").trim()).toBe(s.repo.git("rev-parse", "main").trim());
        expect(s.repo.originGit("rev-parse", "1.0.1^{commit}").trim()).toBe(s.commit);

        const order = github.calls.map((call) => call.split(" ").slice(0, 2).join(" "));
        expect(order.indexOf("repo view")).toBeLessThan(order.indexOf("run list"));
        expect(order.indexOf("run list")).toBeLessThan(order.indexOf("release edit"));
        expect(github.calls.filter((call) => call.startsWith("attestation verify"))).toHaveLength(3);
        expect(github.calls.find((call) => call.startsWith("release edit"))).toBe(`release edit 1.0.1 --repo ${SLUG} --draft=false --latest`);
        expect(github.calls.find((call) => call.startsWith("attestation verify"))).toMatch(new RegExp(`--repo ${SLUG} --signer-workflow Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml --source-ref refs/tags/1.0.1 --source-digest ${s.commit}$`));

        const out = s.ctx.out.join("");
        expect(out).toContain(`✓ gh      ${SLUG}: signed in, admin access`);
        expect(out).toContain("✓ git     pushed the tag 1.0.1 (only the tag; the branch waits for the release)");
        expect(out).toContain("✓ verify  assets: main.js, manifest.json, styles.css");
        expect(out).toContain("main.js, manifest.json, styles.css equal a local build of 1.0.1");
        expect(out).toContain("✓ verify  attestations: main.js, manifest.json, styles.css verified");
        expect(out).toContain(`✓ release  1.0.1 is public and the latest release: https://github.com/${SLUG}/releases/tag/1.0.1`);
        expect(out).toContain("✓ git     pushed main (no force)");
        // The run had finished before opdk looked: no wait to report.
        expect(out).toContain("✓ wait    Release succeeded\n");
        expect(out).toContain(`workflow  https://github.com/${SLUG}/actions/runs/42`);
        expect(leftovers()).toEqual([]);
    });

    it("never forces, never deletes and pushes exactly the tag and then the branch", async () => {
        const s = await scenario();
        expect(await runPublish(s.input())).toBe(0);
        const pushes = s.gitCalls.filter((args) => args[0] === "push");
        expect(pushes).toEqual([
            ["push", "origin", "refs/tags/1.0.1"],
            ["push", "origin", "refs/heads/main:refs/heads/main"],
        ]);
        for (const args of s.gitCalls) {
            expect(args.filter((arg) => /^(--force|-f$|--force-with-lease|--mirror|--delete|--prune|\+)/.test(arg))).toEqual([]);
        }
    });

    it("continues from a tag that is already on origin without pushing it again", async () => {
        const s = await scenario();
        s.repo.git("push", "--quiet", "origin", "refs/tags/1.0.1");
        expect(await runPublish(s.input())).toBe(0);
        expect(s.gitCalls.filter((args) => args[0] === "push" && args[2] === "refs/tags/1.0.1")).toEqual([]);
        expect(s.ctx.out.join("")).toContain("the tag 1.0.1 is already on origin");
    });

    it("continues when the release is already public: no workflow wait, no publish call, the branch is pushed", async () => {
        const s = await scenario();
        s.repo.git("push", "--quiet", "origin", "refs/tags/1.0.1");
        s.github.release = { draft: false, assets: s.github.release?.assets ?? [] };
        s.github.latest = "1.0.1";
        expect(await runPublish(s.input())).toBe(0);
        expect(s.github.calls.some((call) => call.startsWith("run list") || call.startsWith("release edit"))).toBe(false);
        expect(s.ctx.out.join("")).toContain("the release 1.0.1 is already public");
        expect(s.repo.originGit("rev-parse", "main").trim()).toBe(s.repo.git("rev-parse", "main").trim());
    });

    it("expects a zip when asked and accepts only that extra asset", async () => {
        const s = await scenario();
        s.github.release?.assets.push({ name: "fixture-release-1.0.1.zip", bytes: Buffer.from("zip") });
        expect(await runPublish(s.input({ zip: true }))).toBe(0);
        expect(s.github.calls.filter((call) => call.startsWith("attestation verify"))).toHaveLength(3);

        const without = await scenario();
        without.github.release?.assets.push({ name: "fixture-release-1.0.1.zip", bytes: Buffer.from("zip") });
        expect(await runPublish(without.input())).toBe(1);
        expect(without.ctx.err.join("")).toContain("unexpected asset fixture-release-1.0.1.zip");
    });

    it("works for a plugin without styles.css", async () => {
        const s = await scenario();
        s.github.release = { draft: true, assets: s.github.release?.assets.filter((asset) => asset.name !== "styles.css") ?? [] };
        const code = await runPublish(s.input({ buildTagged: () => Promise.resolve({ commit: "abc1234", mainJs: MAIN, css: undefined, manifest: s.manifest }) }));
        expect(code).toBe(0);
        expect(s.github.calls.filter((call) => call.startsWith("attestation verify"))).toHaveLength(2);
    });
});

describe("runPublish: before anything is pushed", () => {
    it("fails without gh, with the install hint, and pushes nothing", async () => {
        const s = await scenario();
        s.github.repoError = new Error("gh is not installed or not on PATH. Install the GitHub CLI from https://cli.github.com and sign in with `gh auth login`.");
        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("the GitHub CLI (gh) is not installed.");
        expect(err).toContain("https://cli.github.com");
        expect(err).toContain("stopped while checking the GitHub CLI.");
        expect(err).toContain("Nothing was pushed.");
        expect(err).toContain("Resume with: opdk release publish 1.0.1");
        expect(remoteTags(s.repo)).toEqual(["1.0.0"]);
    });

    it("explains a repository gh cannot see (signed in as someone else)", async () => {
        const s = await scenario();
        s.github.repoError = new Error("gh repo view example/fixture --json nameWithOwner,viewerPermission failed: GraphQL: Could not resolve to a Repository");
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("gh auth switch");
        expect(remoteTags(s.repo)).toEqual(["1.0.0"]);
    });

    it("refuses an account with read access only", async () => {
        const s = await scenario();
        s.github.permission = "READ";
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("the signed-in gh account has read access to example/fixture, and releasing needs write access.");
        expect(remoteTags(s.repo)).toEqual(["1.0.0"]);
    });

    it("refuses an origin that is not a GitHub URL", async () => {
        const s = await scenario();
        s.repo.git("config", "remote.origin.url", "/some/local/path");
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("does not look like a GitHub repository URL");
    });

    it("needs a local tag", async () => {
        const s = await scenario();
        expect(await runPublish(s.input({ version: "9.9.9" }))).toBe(1);
        expect(s.ctx.err.join("")).toContain("there is no local tag 9.9.9.");
    });

    it("refuses a tag whose commit is not on the default branch", async () => {
        const s = await scenario();
        s.repo.git("switch", "--quiet", "-c", "elsewhere", "1.0.0");
        s.repo.git("branch", "--quiet", "-f", "main", "1.0.0");
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("the tag 1.0.1 is not on main");
        expect(remoteTags(s.repo)).toEqual(["1.0.0"]);
    });

    it("refuses a lightweight tag and a tag whose manifest has another version", async () => {
        const s = await scenario();
        s.repo.git("tag", "light", "HEAD");
        expect(await runPublish(s.input({ version: "light" }))).toBe(1);
        expect(s.ctx.err.join("")).toContain("the tag light is a lightweight tag");

        const mismatch = await scenario();
        mismatch.repo.git("tag", "-a", "1.0.2", "-m", "1.0.2", "HEAD");
        expect(await runPublish(mismatch.input({ version: "1.0.2" }))).toBe(1);
        expect(mismatch.ctx.err.join("")).toContain("holds a manifest.json with version 1.0.1");
        expect(remoteTags(mismatch.repo)).toEqual(["1.0.0"]);
    });

    it("refuses when origin has the tag at another object", async () => {
        const s = await scenario();
        const other = mkdtempSync(path.join(tmp, "clone-"));
        execFileSync("git", ["clone", "--quiet", s.repo.origin, other], { env: hermeticGitEnv() });
        const env = hermeticGitEnv();
        execFileSync("git", ["-c", "user.name=x", "-c", "user.email=x@example.com", "tag", "-a", "1.0.1", "-m", "elsewhere", "1.0.0^{commit}"], { cwd: other, env });
        execFileSync("git", ["push", "--quiet", "origin", "refs/tags/1.0.1"], { cwd: other, env });
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("origin already has a tag 1.0.1 that points elsewhere");
    });

    it("needs the default branch to be known", async () => {
        const s = await scenario();
        s.repo.git("remote", "set-head", "origin", "--delete");
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("the default branch is unknown");
        expect(await runPublish(s.input({ defaultBranch: "main" }))).toBe(0);
    });
});

describe("runPublish: the workflow", () => {
    it("prints the run URL and stops when the workflow fails; the tag stays and the branch is not pushed", async () => {
        const s = await scenario();
        const originMain = s.repo.originGit("rev-parse", "main").trim();
        s.github.runs = [{ ...(s.github.runs[0] ?? {}), status: "in_progress", conclusion: "" }];
        s.github.runStates = ["in_progress/", "completed/failure"];
        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain(`the release workflow ended with "failure": https://github.com/${SLUG}/actions/runs/42`);
        expect(err).toContain("release a new patch version, or re-run the failed jobs on GitHub and then run `opdk release publish 1.0.1`");
        expect(err).toContain("stopped while waiting for the release workflow.");
        expect(err).toContain("The tag 1.0.1 is on origin.");
        expect(err).toContain("Resume with: opdk release publish 1.0.1");
        expect(remoteTags(s.repo)).toEqual(["1.0.0", "1.0.1"]);
        expect(s.repo.originGit("rev-parse", "main").trim()).toBe(originMain);
        expect(s.github.calls.some((call) => call.startsWith("release edit"))).toBe(false);
    });

    it("prints a progress line when the state changes and a heartbeat while it stays", async () => {
        const s = await scenario();
        s.github.runs = [{ ...(s.github.runs[0] ?? {}), status: "queued", conclusion: "" }];
        s.github.runStates = ["queued/", "in_progress/", ...Array<string>(10).fill("in_progress/"), "completed/success"];
        expect(await runPublish(s.input())).toBe(0);
        const out = s.ctx.out.join("");
        expect(out).toContain("· wait    Release run 42: queued https://github.com/example/fixture/actions/runs/42");
        expect(out).toContain("· wait    Release run 42: in_progress");
        expect(out).toMatch(/· wait {4}still in_progress after \d+ min/);
        expect(out).toMatch(/✓ wait {4}Release succeeded in \d+ min/);
    });

    it("picks the run of the tagged commit and ignores other runs", async () => {
        const s = await scenario();
        s.github.runs = [
            { databaseId: 99, status: "completed", conclusion: "failure", event: "push", headSha: "0".repeat(40), url: "https://example.com/other", workflowName: "Release", createdAt: "2026-11-12T10:00:00Z" },
            ...s.github.runs,
        ];
        expect(await runPublish(s.input())).toBe(0);
    });

    it("stops with a hint when no run ever starts for the tag", async () => {
        const s = await scenario();
        s.github.runs = [];
        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("no workflow run started for the tag 1.0.1 within 3 min.");
        expect(err).toContain("push: tags");
        expect(err).toContain("is not pushed twice");
        expect(s.clock.elapsed()).toBeGreaterThanOrEqual(3 * 60_000);
    });

    it("stops at the timeout and names the run", async () => {
        const s = await scenario();
        s.github.runs = [{ ...(s.github.runs[0] ?? {}), status: "in_progress", conclusion: "" }];
        s.github.runStates = ["in_progress/"];
        expect(await runPublish(s.input({ timeoutMs: 60_000 }))).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain(`the release workflow did not finish within 1 min: https://github.com/${SLUG}/actions/runs/42`);
        expect(err).toContain("--timeout");
    });

    it("treats a cancelled run as a failure", async () => {
        const s = await scenario();
        s.github.runs = [{ ...(s.github.runs[0] ?? {}), conclusion: "cancelled" }];
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain('ended with "cancelled"');
    });

    it("fails when the workflow succeeded but made no release", async () => {
        const s = await scenario();
        s.github.release = undefined;
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("the workflow succeeded but there is no release for 1.0.1.");
    });
});

describe("runPublish: the draft is checked before it is made public", () => {
    async function expectRefused(mutate: (s: Scenario) => void, message: string | RegExp): Promise<Scenario> {
        const s = await scenario();
        const originMain = s.repo.originGit("rev-parse", "main").trim();
        mutate(s);
        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toMatch(message);
        expect(err).toContain("Nothing was published.");
        expect(err).toContain("Resume with: opdk release publish 1.0.1");
        expect(s.github.calls.some((call) => call.startsWith("release edit"))).toBe(false);
        expect(s.repo.originGit("rev-parse", "main").trim()).toBe(originMain);
        expect(leftovers()).toEqual([]);
        return s;
    }

    it("refuses a missing asset", async () => {
        await expectRefused((s) => {
            s.github.release = { draft: true, assets: s.github.release?.assets.filter((asset) => asset.name !== "main.js") ?? [] };
        }, "the release has no asset main.js.");
    });

    it("refuses an unexpected asset", async () => {
        await expectRefused((s) => {
            s.github.release?.assets.push({ name: "notes.txt", bytes: Buffer.from("x") });
        }, "unexpected asset notes.txt");
    });

    it("refuses a styles.css when the plugin builds none", async () => {
        const s = await scenario();
        const code = await runPublish(s.input({ buildTagged: () => Promise.resolve({ commit: "abc1234", mainJs: MAIN, css: undefined, manifest: s.manifest }) }));
        expect(code).toBe(1);
        expect(s.ctx.err.join("")).toContain("unexpected asset styles.css");
    });

    it("refuses an asset that is empty or not finished uploading", async () => {
        await expectRefused((s) => {
            s.github.release = { draft: true, assets: [{ name: "main.js", bytes: Buffer.alloc(0) }, { name: "manifest.json", bytes: s.manifest }, { name: "styles.css", bytes: CSS, state: "starter" }] };
        }, "the asset main.js is empty.");
    });

    it("refuses a main.js that differs from the build of the tag and names the first differing byte", async () => {
        const s = await expectRefused((current) => {
            current.github.release = { draft: true, assets: [{ name: "main.js", bytes: Buffer.from("console.log('other');\n") }, { name: "manifest.json", bytes: current.manifest }, { name: "styles.css", bytes: CSS }] };
        }, /main\.js differs between the release asset and a build of the tag 1\.0\.1 \(commit [0-9a-f]{7}\): first difference at byte 13/);
        expect(s.github.calls.some((call) => call.startsWith("attestation verify"))).toBe(false);
    });

    it("refuses a manifest.json that differs from the committed one", async () => {
        await expectRefused((s) => {
            s.github.release = { draft: true, assets: [{ name: "main.js", bytes: MAIN }, { name: "manifest.json", bytes: Buffer.from(`${s.manifest.toString("utf8")} `) }, { name: "styles.css", bytes: CSS }] };
        }, /manifest\.json differs between/);
    });

    it("refuses an attestation that does not verify", async () => {
        const s = await expectRefused((current) => {
            current.github.unattested.add("styles.css");
        }, "the attestation of styles.css does not verify: gh attestation verify failed: no attestations found");
        expect(s.ctx.err.join("")).toContain("must be attested by Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml for example/fixture at the tag 1.0.1");
    });

    it("stops when the release is still a draft after publishing", async () => {
        const s = await scenario();
        s.github.editIsIgnored = true;
        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("the release 1.0.1 is still a draft after publishing.");
        expect(err).toContain("The branch main was not pushed");
    });

    it("stops when the published release is not the latest one", async () => {
        const s = await scenario();
        s.github.publishKeepsLatest = true;
        s.github.latest = "2.0.0";
        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("the release 1.0.1 is public but GitHub's latest release is 2.0.0.");
        expect(err).toContain("stopped while confirming the latest release.");
        expect(err).toContain("The release 1.0.1 is public.");
    });
});

describe("runPublish: the branch", () => {
    it("says the release is already public when origin rejects the branch, and what to do", async () => {
        const s = await scenario();
        const other = mkdtempSync(path.join(tmp, "clone-"));
        const env = hermeticGitEnv();
        execFileSync("git", ["clone", "--quiet", s.repo.origin, other], { env });
        execFileSync("git", ["-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "--quiet", "--allow-empty", "-m", "someone else"], { cwd: other, env });
        execFileSync("git", ["push", "--quiet", "origin", "main"], { cwd: other, env });
        const theirs = s.repo.originGit("rev-parse", "main").trim();

        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("origin rejected the push of main: it has commits that are not here. The release 1.0.1 is already public.");
        expect(err).toContain("git pull --no-rebase origin main");
        expect(err).toContain("stopped while pushing the branch.");
        expect(err).toContain("The release 1.0.1 is public.");
        expect(s.github.release?.draft).toBe(false);
        // Nothing was forced: their commit is still the head of main.
        expect(s.repo.originGit("rev-parse", "main").trim()).toBe(theirs);
        expect(remoteTags(s.repo)).toEqual(["1.0.0", "1.0.1"]);
    });

    it("reports another push failure with the command to run by hand", async () => {
        const s = await scenario();
        const base = s.input();
        const run: RunGit = (args) => (args[0] === "push" && args[2]?.startsWith("refs/heads/") ? Promise.reject(new Error("git push failed: remote: Permission denied")) : base.run(args));
        expect(await runPublish({ ...base, run })).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("could not push main: git push failed: remote: Permission denied");
        expect(err).toContain("run `git push origin main`");
    });
});

describe("runPublish: Ctrl+C", () => {
    function hooks(): { listeners: (() => void)[]; exits: number[]; removed: number; api: NonNullable<PublishInput["interrupt"]> } {
        const state = { listeners: [] as (() => void)[], exits: [] as number[], removed: 0 };
        return {
            get listeners() {
                return state.listeners;
            },
            exits: state.exits,
            get removed() {
                return state.removed;
            },
            api: {
                onInterrupt: (listener) => {
                    state.listeners.push(listener);
                    return () => {
                        state.removed++;
                        state.listeners.splice(state.listeners.indexOf(listener), 1);
                    };
                },
                exit: (code) => {
                    state.exits.push(code);
                },
            },
        };
    }

    it("says where it stopped, what is on origin and how to resume, while waiting for the workflow", async () => {
        const s = await scenario();
        const interrupt = hooks();
        s.github.runs = [{ ...(s.github.runs[0] ?? {}), status: "in_progress", conclusion: "" }];
        s.github.runStates = ["in_progress/"];
        const clock = s.clock;
        let slept = 0;
        const sleep = clock.sleep.bind(clock);
        const waiting = { ...clock, sleep: (ms: number) => {
            if (++slept === 2) {
                for (const listener of [...interrupt.listeners]) {
                    listener();
                }
            }
            return sleep(ms);
        } };
        const code = await runPublish(s.input({ clock: waiting, interrupt: interrupt.api, timeoutMs: 60_000 }));
        expect(interrupt.exits).toEqual([130]);
        expect(code).toBe(130);
        const err = s.ctx.err.join("");
        expect(err).toContain("1.0.1: interrupted while waiting for the release workflow");
        expect(err).toContain("The tag 1.0.1 is on origin.");
        expect(err).toContain("The release is not public (a draft at most).");
        expect(err).toContain("The branch main was not pushed.");
        expect(err).toContain("Resume with: opdk release publish 1.0.1");
        expect(interrupt.removed).toBe(1);
        expect(remoteTags(s.repo)).toEqual(["1.0.0", "1.0.1"]);
        expect(leftovers()).toEqual([]);
    });

    it("warns that the tag push was in flight when it arrives during the push, and removes the temp folders of the verification", async () => {
        const s = await scenario();
        const interrupt = hooks();
        const base = s.input();
        const run: RunGit = (args) => {
            if (args[0] === "push") {
                for (const listener of [...interrupt.listeners]) {
                    listener();
                }
            }
            return base.run(args);
        };
        await runPublish({ ...base, run, interrupt: interrupt.api });
        expect(s.ctx.err.join("")).toContain("The push of the tag 1.0.1 was in flight: check `git ls-remote --tags origin 1.0.1`");
        expect(interrupt.exits.every((exit) => exit === 130)).toBe(true);
    });

    it("removes the downloaded assets when it arrives while verifying", async () => {
        const s = await scenario();
        const interrupt = hooks();
        const seen: string[][] = [];
        const github = s.github;
        const bytes = github.bytes.bind(github);
        github.bytes = async (args) => {
            seen.push(leftovers());
            for (const listener of [...interrupt.listeners]) {
                listener();
            }
            return bytes(args);
        };
        const code = await runPublish(s.input({ interrupt: interrupt.api }));
        expect(code).toBe(130);
        expect(seen[0]).toHaveLength(1);
        expect(s.ctx.err.join("")).toContain("interrupted while verifying the draft release");
        expect(leftovers()).toEqual([]);
    });
});

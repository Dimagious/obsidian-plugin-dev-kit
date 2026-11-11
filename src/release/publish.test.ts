import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext, type CapturedContext } from "../test-support/plugin-fixture.js";
import { FakeGithub, fakeClock, kitRun } from "../test-support/fake-github.js";
import { createReleaseRepo, hermeticGitEnv, type ReleaseRepo } from "../test-support/release-fixture.js";
import type { TaggedBuild } from "./build-tagged.js";
import type { RunGit } from "./git.js";
import { runPublish, type PublishInput } from "./publish.js";
import { changelogNotes } from "./publish-command.js";
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
    github.commit = commit;
    const notes = changelogNotes(current.dir, {}, "1.0.1");
    github.notes = notes;
    github.runs = [kitRun(SLUG, commit)];
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
            notes: () => Promise.resolve(notes),
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
        const listed = github.calls.findIndex((call) => call.includes("/actions/runs?"));
        expect(order.indexOf("repo view")).toBeLessThan(listed);
        expect(listed).toBeLessThan(order.indexOf("release edit"));
        expect(github.calls[listed]).toBe(`api repos/${SLUG}/actions/runs?head_sha=${s.commit}&event=push&per_page=100`);
        expect(github.calls.filter((call) => call.startsWith("attestation verify"))).toHaveLength(3);
        expect(github.calls.find((call) => call.startsWith("release edit"))).toBe(`release edit 1.0.1 --repo ${SLUG} --draft=false --latest`);
        expect(github.calls.find((call) => call.startsWith("attestation verify"))).toContain(
            ` --repo ${SLUG} --cert-identity-regex ^https://github\\.com/Dimagious/obsidian-plugin-dev-kit/\\.github/workflows/release\\.yml@ --source-ref refs/tags/1.0.1 --source-digest ${s.commit}`,
        );

        const out = s.ctx.out.join("");
        expect(out).toContain(`✓ gh      ${SLUG}: signed in, admin access`);
        expect(out).toContain("✓ git     pushed the tag 1.0.1 (only the tag; the branch waits for the release)");
        expect(out).toContain("✓ verify  assets: main.js, manifest.json, styles.css");
        expect(out).toContain("main.js, manifest.json, styles.css equal a local build of 1.0.1");
        expect(out).toContain("✓ verify  attestations: main.js, manifest.json, styles.css verified");
        expect(out).toContain(`✓ release  1.0.1 is public and the latest release: https://github.com/${SLUG}/releases/tag/1.0.1`);
        expect(out).toContain("✓ git     pushed the release commit to main (no force)");
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
            ["push", "origin", `${s.commit}:refs/heads/main`],
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
        expect(s.github.calls.some((call) => call.includes("/actions/runs") || call.startsWith("release edit"))).toBe(false);
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
        expect(err).toContain("Nothing new was pushed.");
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
        expect(s.ctx.err.join("")).not.toContain("Resume with");

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
        expect(s.ctx.err.join("")).not.toContain("Resume with");
        expect(s.ctx.err.join("")).toContain("opdk release patch");
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
        s.github.runs = [kitRun(SLUG, s.commit, { status: "in_progress", conclusion: null })];
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
        s.github.runs = [kitRun(SLUG, s.commit, { status: "queued", conclusion: null })];
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
        s.github.runs = [kitRun(SLUG, "0".repeat(40), { id: 99, conclusion: "failure", created_at: "2026-11-12T10:00:00Z" }), ...s.github.runs];
        expect(await runPublish(s.input())).toBe(0);
        expect(s.ctx.out.join("")).toContain(`workflow  https://github.com/${SLUG}/actions/runs/42`);
    });

    it("takes the run of the asked tag when another tag on the same commit has a newer failed run", async () => {
        const s = await scenario();
        s.github.runs = [...s.github.runs, kitRun(SLUG, s.commit, { id: 55, head_branch: "1.0.2", conclusion: "failure", created_at: "2026-11-12T10:00:00Z" })];
        expect(await runPublish(s.input())).toBe(0);
        expect(s.ctx.out.join("")).toContain(`workflow  https://github.com/${SLUG}/actions/runs/42`);
    });

    it("waits for the kit's release run, not for a newer Pages run on the same commit", async () => {
        const s = await scenario();
        const pages = kitRun(SLUG, s.commit, { id: 77, name: "Pages", status: "completed", conclusion: "success", created_at: "2026-11-11T10:05:00Z", referenced_workflows: [] });
        s.github.runs = [kitRun(SLUG, s.commit, { status: "in_progress", conclusion: null }), pages];
        s.github.runStates = ["in_progress/", "completed/success"];
        expect(await runPublish(s.input())).toBe(0);
        const out = s.ctx.out.join("");
        expect(out).toContain("· wait    Release run 42: in_progress");
        expect(out).not.toContain("Pages");
        expect(s.github.calls.filter((call) => call.endsWith("/actions/runs/77"))).toEqual([]);
        expect(s.github.calls.some((call) => call.endsWith("/actions/runs/42"))).toBe(true);
    });

    it("does not take a run of a copy of the workflow or of another repository's workflow for the release run", async () => {
        const s = await scenario();
        s.github.runs = [kitRun(SLUG, s.commit, { referenced_workflows: [{ path: `${SLUG}/.github/workflows/release.yml@${"b".repeat(40)}`, sha: "b", ref: "main" }] })];
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("none of them calls the kit's release workflow");
    });

    it("stops with a hint when no run ever starts for the tag", async () => {
        const s = await scenario();
        s.github.runs = [];
        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("no release workflow run started for the tag 1.0.1 within 3 min.");
        expect(err).toContain("must call the kit's workflow: `uses: Dimagious/obsidian-plugin-dev-kit/.github/workflows/release.yml@<full commit SHA of the kit>`");
        expect(err).toContain("is not pushed twice");
        expect(s.clock.elapsed()).toBeGreaterThanOrEqual(3 * 60_000);
    });

    it("stops at the timeout and names the run", async () => {
        const s = await scenario();
        s.github.runs = [kitRun(SLUG, s.commit, { status: "in_progress", conclusion: null })];
        s.github.runStates = ["in_progress/"];
        expect(await runPublish(s.input({ timeoutMs: 60_000 }))).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain(`the release workflow did not finish within 1 min: https://github.com/${SLUG}/actions/runs/42`);
        expect(err).toContain("--timeout");
    });

    it("treats a cancelled run as a failure", async () => {
        const s = await scenario();
        s.github.runs = [kitRun(SLUG, s.commit, { conclusion: "cancelled" })];
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
        expect(err).toContain("opdk release patch");
        expect(err).not.toContain("Resume with");
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

    it("refuses a draft whose notes differ from the CHANGELOG at the tag and shows both", async () => {
        const s = await expectRefused((current) => {
            current.github.notes = "### Added\n\n- Something nobody wrote in the changelog.\n";
        }, "the notes of the release 1.0.1 do not match the CHANGELOG at the tag");
        const err = s.ctx.err.join("");
        expect(err).toContain("Something nobody wrote in the changelog.");
        expect(err).toContain("Word count in the status bar.");
        expect(s.github.calls.some((call) => call.startsWith("attestation verify"))).toBe(false);
    });

    it("truncates long notes in the mismatch message", async () => {
        const s = await expectRefused((current) => {
            current.github.notes = `${"x".repeat(1000)}\n`;
        }, "do not match the CHANGELOG");
        expect(s.ctx.err.join("")).toContain("(1000 characters)");
        expect(s.ctx.err.join("")).not.toContain("x".repeat(400));
    });

    it("accepts notes that differ from the CHANGELOG only in trailing whitespace", async () => {
        const s = await scenario();
        s.github.notes = `${changelogNotes(s.repo.dir, {}, "1.0.1").trimEnd()}\n\n  \n`;
        expect(await runPublish(s.input())).toBe(0);
        expect(s.ctx.out.join("")).toContain("release notes equal the CHANGELOG section of 1.0.1");
    });

    it("stops without resuming when the notes of the tag cannot be read", async () => {
        const s = await scenario();
        expect(await runPublish(s.input({ notes: () => Promise.reject(new Error('CHANGELOG.md has no "## [1.0.1]" section.')) }))).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain('cannot read the release notes of the tag 1.0.1: CHANGELOG.md has no "## [1.0.1]" section.');
        expect(err).not.toContain("Resume with");
        expect(s.github.calls.some((call) => call.startsWith("release edit"))).toBe(false);
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
        const run: RunGit = (args) => (args[0] === "push" && args[2]?.includes(":refs/heads/") ? Promise.reject(new Error("git push failed: remote: Permission denied")) : base.run(args));
        expect(await runPublish({ ...base, run })).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("could not push main: git push failed: remote: Permission denied");
        expect(err).toContain("run `git push origin main`");
    });
});

describe("runPublish: stages and a release that is already public", () => {
    it("reports the tag as pushed when the release lookup right after the push fails", async () => {
        const s = await scenario();
        const github = s.github;
        const text = github.text.bind(github);
        github.text = (args) => (args[1]?.includes("/releases?") === true ? Promise.reject(new Error("gh api releases failed: HTTP 502")) : text(args));
        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("stopped while looking up the release.");
        expect(err).toContain("The tag 1.0.1 is on origin.");
        expect(err).not.toContain("The tag 1.0.1 was not pushed");
        expect(err).toContain("Resume with: opdk release publish 1.0.1");
        expect(remoteTags(s.repo)).toEqual(["1.0.0", "1.0.1"]);
    });

    async function publicRelease(mutate: (s: Scenario) => void): Promise<Scenario> {
        const s = await scenario();
        s.repo.git("push", "--quiet", "origin", "refs/tags/1.0.1");
        s.github.release = { draft: false, assets: s.github.release?.assets ?? [] };
        s.github.latest = "1.0.1";
        mutate(s);
        expect(await runPublish(s.input())).toBe(1);
        return s;
    }

    it("never says a public release is a draft or tells to delete it when its attestation does not verify", async () => {
        const s = await publicRelease((current) => {
            current.github.unattested.add("main.js");
        });
        const err = s.ctx.err.join("");
        expect(err).toContain("the attestation of main.js does not verify");
        expect(err).toContain("The release 1.0.1 is already public, so this flow changes nothing. Do not delete it");
        expect(err).toContain("The release 1.0.1 is public.");
        expect(err).not.toContain("not public");
        expect(err).not.toContain("delete the draft");
        expect(err).not.toContain("Nothing was published");
        expect(err).not.toContain("Resume with");
        expect(s.github.calls.some((call) => call.startsWith("release edit"))).toBe(false);
        expect(s.repo.originGit("rev-parse", "main").trim()).not.toBe(s.repo.git("rev-parse", "main").trim());
    });

    it("says the same when the bytes of a public release differ", async () => {
        const s = await publicRelease((current) => {
            current.github.release = { draft: false, assets: [{ name: "main.js", bytes: Buffer.from("other\n") }, { name: "manifest.json", bytes: current.manifest }, { name: "styles.css", bytes: CSS }] };
        });
        const err = s.ctx.err.join("");
        expect(err).toContain("main.js differs between the release asset and a build of the tag");
        expect(err).toContain("Do not delete it");
        expect(err).not.toContain("delete the draft");
        expect(err).toContain("The release 1.0.1 is public.");
    });

    it("says the same when a public release lacks an asset", async () => {
        const s = await publicRelease((current) => {
            current.github.release = { draft: false, assets: current.github.release?.assets.filter((asset) => asset.name !== "styles.css") ?? [] };
        });
        expect(s.ctx.err.join("")).toContain("Do not delete it");
        expect(s.ctx.err.join("")).toContain("The release 1.0.1 is public.");
    });
});

describe("runPublish: reading the releases", () => {
    it("reads every page of the release list", async () => {
        const s = await scenario();
        s.github.otherReleases = 150;
        expect(await runPublish(s.input())).toBe(0);
        const pages = s.github.calls.filter((call) => call.includes("/releases?per_page=100&page="));
        expect(pages.some((call) => call.endsWith("page=2"))).toBe(true);
    });

    it("refuses two releases for one tag and keeps the tag", async () => {
        const s = await scenario();
        s.github.duplicateRelease = true;
        expect(await runPublish(s.input())).toBe(1);
        const err = s.ctx.err.join("");
        expect(err).toContain("GitHub has 2 releases for the tag 1.0.1");
        expect(err).toContain("delete the other(s) on GitHub");
        expect(err).toContain("Resume with: opdk release publish 1.0.1");
        expect(s.github.calls.some((call) => call.startsWith("release edit"))).toBe(false);
    });

    it("stops instead of guessing when the list is longer than it reads", async () => {
        const s = await scenario();
        s.github.otherReleases = 3000;
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("has more than 3000 releases");
    });
});

describe("runPublish: GitHub's latest release", () => {
    it("stops with a plain message when a repository with no latest release stays without one after publishing", async () => {
        const s = await scenario();
        s.github.publishKeepsLatest = true;
        s.github.latest = undefined;
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("the release 1.0.1 is public but GitHub has no latest release.");
    });

    it("tolerates a 404 while the latest release appears (replication lag)", async () => {
        const s = await scenario();
        const github = s.github;
        const text = github.text.bind(github);
        let asked = 0;
        github.text = (args) => {
            if (args[1]?.endsWith("/releases/latest") === true && asked++ < 2) {
                return Promise.reject(new Error("gh api releases/latest failed: gh: Not Found (HTTP 404)"));
            }
            return text(args);
        };
        expect(await runPublish(s.input())).toBe(0);
        expect(asked).toBe(3);
    });

    it("passes another failure of the latest lookup on", async () => {
        const s = await scenario();
        const github = s.github;
        const text = github.text.bind(github);
        github.text = (args) => (args[1]?.endsWith("/releases/latest") === true ? Promise.reject(new Error("gh api releases/latest failed: HTTP 500")) : text(args));
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("HTTP 500");
        expect(s.ctx.err.join("")).toContain("stopped while confirming the latest release.");
    });

    it("warns, and still pushes the branch, when a release that was public before is not the latest", async () => {
        const s = await scenario();
        s.repo.git("push", "--quiet", "origin", "refs/tags/1.0.1");
        s.github.release = { draft: false, assets: s.github.release?.assets ?? [] };
        s.github.latest = "2.0.0";
        expect(await runPublish(s.input())).toBe(0);
        const out = s.ctx.out.join("");
        expect(out).toContain("GitHub's latest release is 2.0.0, not 1.0.1.");
        expect(out).toContain("✓ release  1.0.1 is public: ");
        expect(s.repo.originGit("rev-parse", "main").trim()).toBe(s.repo.git("rev-parse", "main").trim());
    });

    it("says there is no latest release when the resumed repository has none", async () => {
        const s = await scenario();
        s.repo.git("push", "--quiet", "origin", "refs/tags/1.0.1");
        s.github.release = { draft: false, assets: s.github.release?.assets ?? [] };
        s.github.latest = undefined;
        expect(await runPublish(s.input())).toBe(0);
        expect(s.ctx.out.join("")).toContain("GitHub has no latest release, not 1.0.1.");
    });
});

describe("runPublish: resuming", () => {
    it("continues from a draft that is already there with the tag on origin, and waits for a run that is still going", async () => {
        const s = await scenario();
        s.repo.git("push", "--quiet", "origin", "refs/tags/1.0.1");
        s.github.runs = [kitRun(SLUG, s.commit, { status: "in_progress", conclusion: null })];
        s.github.runStates = ["in_progress/", "completed/success"];
        expect(await runPublish(s.input())).toBe(0);
        expect(s.gitCalls.filter((args) => args[0] === "push" && args[2] === "refs/tags/1.0.1")).toEqual([]);
        expect(s.github.calls.filter((call) => call.startsWith("release edit"))).toHaveLength(1);
        expect(s.ctx.out.join("")).toContain("✓ wait    Release succeeded");
    });

    it("pushes the release commit, not the local tip, when the branch moved on locally", async () => {
        const s = await scenario();
        s.repo.git("commit", "--quiet", "--allow-empty", "-m", "work after the release");
        const tip = s.repo.git("rev-parse", "main").trim();
        expect(tip).not.toBe(s.commit);
        expect(await runPublish(s.input())).toBe(0);
        expect(s.repo.originGit("rev-parse", "main").trim()).toBe(s.commit);
        expect(s.gitCalls.filter((args) => args[0] === "push").at(-1)).toEqual(["push", "origin", `${s.commit}:refs/heads/main`]);
    });

    it("pushes nothing on a second run after a complete one", async () => {
        const s = await scenario();
        expect(await runPublish(s.input())).toBe(0);
        const pushes = s.gitCalls.filter((args) => args[0] === "push").length;
        const editsBefore = s.github.calls.filter((call) => call.startsWith("release edit")).length;
        s.ctx.out.length = 0;
        expect(await runPublish(s.input())).toBe(0);
        expect(s.gitCalls.filter((args) => args[0] === "push")).toHaveLength(pushes);
        expect(s.github.calls.filter((call) => call.startsWith("release edit"))).toHaveLength(editsBefore);
        expect(s.ctx.out.join("")).toContain("main on origin already holds the release commit");
    });

    it("recognises an origin that holds the release commit plus newer commits this clone never fetched", async () => {
        const s = await scenario();
        s.repo.git("push", "--quiet", "origin", `${s.commit}:refs/heads/main`);
        const other = mkdtempSync(path.join(tmp, "clone-"));
        const env = hermeticGitEnv();
        execFileSync("git", ["clone", "--quiet", s.repo.origin, other], { env });
        execFileSync("git", ["-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "--quiet", "--allow-empty", "-m", "someone else"], { cwd: other, env });
        execFileSync("git", ["push", "--quiet", "origin", "main"], { cwd: other, env });
        const newer = s.repo.originGit("rev-parse", "main").trim();
        expect(newer).not.toBe(s.commit);

        expect(await runPublish(s.input())).toBe(0);

        expect(s.ctx.err.join("")).toBe("");
        expect(s.gitCalls).toContainEqual(["fetch", "--no-tags", "origin", "main"]);
        expect(s.gitCalls.filter((args) => args[0] === "push" && args[2]?.endsWith(":refs/heads/main") === true)).toEqual([]);
        expect(s.repo.originGit("rev-parse", "main").trim()).toBe(newer);
        const out = s.ctx.out.join("");
        expect(out).toContain("main on origin already holds the release commit");
        expect(out).toContain("branch    main already contained the release commit;");
    });

    it("says the branch was pushed when it was", async () => {
        const s = await scenario();
        expect(await runPublish(s.input())).toBe(0);
        const out = s.ctx.out.join("");
        expect(out).toContain("branch    main pushed;");
        expect(out).not.toContain("already contained");
    });

    it("finishes after origin rejected the branch: the owner merges and pushes by hand, then the same command succeeds", async () => {
        const s = await scenario();
        const other = mkdtempSync(path.join(tmp, "clone-"));
        const env = hermeticGitEnv();
        execFileSync("git", ["clone", "--quiet", s.repo.origin, other], { env });
        execFileSync("git", ["-c", "user.name=x", "-c", "user.email=x@example.com", "commit", "--quiet", "--allow-empty", "-m", "someone else"], { cwd: other, env });
        execFileSync("git", ["push", "--quiet", "origin", "main"], { cwd: other, env });
        expect(await runPublish(s.input())).toBe(1);
        expect(s.ctx.err.join("")).toContain("origin rejected the push of main");
        expect(s.ctx.err.join("")).toContain("Resume with: opdk release publish 1.0.1");

        // The recovery the message describes.
        s.repo.git("pull", "--quiet", "--no-rebase", "--no-edit", "origin", "main");
        s.repo.git("push", "--quiet", "origin", "main");

        const pushesBefore = s.gitCalls.filter((args) => args[0] === "push").length;
        s.ctx.out.length = 0;
        s.ctx.err.length = 0;
        expect(await runPublish(s.input())).toBe(0);
        expect(s.ctx.err.join("")).toBe("");
        const out = s.ctx.out.join("");
        expect(out).toContain("the release 1.0.1 is already public, so the workflow is not waited for");
        expect(out).toContain("main on origin already holds the release commit");
        expect(s.gitCalls.filter((args) => args[0] === "push")).toHaveLength(pushesBefore);
        expect(s.github.calls.filter((call) => call.startsWith("release edit"))).toHaveLength(1);
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
                // process.exit never returns: the sentinel stops the flow the same way.
                exit: (code) => {
                    state.exits.push(code);
                    throw new Error("process.exit");
                },
            },
        };
    }

    it("says where it stopped, what is on origin and how to resume, while waiting for the workflow", async () => {
        const s = await scenario();
        const interrupt = hooks();
        s.github.runs = [kitRun(SLUG, s.commit, { status: "in_progress", conclusion: null })];
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
        const code = await runPublish({ ...base, run, interrupt: interrupt.api });
        expect(code).toBe(130);
        expect(s.ctx.err.join("")).toContain("The push of the tag 1.0.1 was in flight: check `git ls-remote --tags origin 1.0.1`");
        expect(interrupt.exits).toEqual([130]);
        // The flow stopped at the exit, as the process would: no push went out, nothing was published.
        expect(s.github.calls.some((call) => call.startsWith("release edit"))).toBe(false);
        expect(s.gitCalls.filter((args) => args[0] === "push")).toEqual([]);
        expect(remoteTags(s.repo)).toEqual(["1.0.0"]);
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
        expect(interrupt.exits).toEqual([130]);
        expect(s.github.calls.some((call) => call.startsWith("release edit"))).toBe(false);
        expect(seen[0]).toHaveLength(1);
        expect(s.ctx.err.join("")).toContain("interrupted while verifying the draft release");
        expect(leftovers()).toEqual([]);
    });
});

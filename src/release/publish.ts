import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Reporter } from "../cli/reporter.js";
import type { TaggedBuild } from "./build-tagged.js";
import type { RunGh } from "./gh.js";
import { checkGhAccess } from "./gh-access.js";
import type { RunGit } from "./git.js";
import { CleanupSet, INTERRUPTED_EXIT, type InterruptHooks } from "./interrupt.js";
import { asRecord } from "./json.js";
import { pushBranch, pushTag, readTagFacts, type TagFacts } from "./publish-git.js";
import { StepFailure, stopReport, type Stage } from "./publish-state.js";
import { fetchRelease, verifyRelease } from "./publish-verify.js";
import { waitForWorkflow, type Clock } from "./publish-wait.js";
import { slugText, type RepoSlug } from "./remote.js";
import type { ReleaseInfo } from "./release-assets.js";

export interface PublishInput {
    readonly version: string;
    readonly reporter: Reporter;
    readonly run: RunGit;
    readonly gh: RunGh;
    /** From `release.defaultBranch`; else `origin/HEAD`. */
    readonly defaultBranch: string | undefined;
    /** A production build of the tagged commit; the release assets must equal it. */
    readonly buildTagged: (cleanups: CleanupSet) => Promise<TaggedBuild>;
    /** Expect `<id>-<version>.zip` among the assets (the workflow's `zip: true`). */
    readonly zip: boolean;
    readonly timeoutMs: number;
    readonly appearMs: number;
    readonly pollMs: number;
    readonly clock: Clock;
    /** Ctrl+C handling: says where the flow stopped and how to resume, then exits with 130. */
    readonly interrupt?: InterruptHooks;
}

export const DEFAULT_TIMEOUT_MINUTES = 20;
export const DEFAULT_APPEAR_MS = 3 * 60_000;
export const DEFAULT_POLL_MS = 10_000;

/** After a `gh release edit`, GitHub lists the release as public at once; a short retry covers replication lag. */
const LATEST_ATTEMPTS = 5;

interface LatestCheck {
    readonly isLatest: boolean;
    /** The tag GitHub calls the latest release; undefined when it has none (the API answers 404 then). */
    readonly seen: string | undefined;
}

async function confirmLatest(gh: RunGh, slug: RepoSlug, version: string, clock: Clock): Promise<LatestCheck> {
    let seen: string | undefined;
    for (let attempt = 0; attempt < LATEST_ATTEMPTS; attempt++) {
        seen = await latestTag(gh, slug);
        if (seen === version) {
            return { isLatest: true, seen };
        }
        await clock.sleep(2_000);
    }
    return { isLatest: false, seen };
}

/** `releases/latest` answers 404 while the repository has no published release: that is "none", not a failure. */
async function latestTag(gh: RunGh, slug: RepoSlug): Promise<string | undefined> {
    let json: string;
    try {
        json = await gh.text(["api", `repos/${slugText(slug)}/releases/latest`]);
    } catch (error) {
        if (error instanceof Error && error.message.includes("HTTP 404")) {
            return undefined;
        }
        throw error;
    }
    const latest = asRecord(JSON.parse(json));
    return typeof latest?.tag_name === "string" ? latest.tag_name : undefined;
}

const describeLatest = (seen: string | undefined): string => (seen === undefined ? "GitHub has no latest release" : `GitHub's latest release is ${seen}`);

/**
 * The push flow, from a local annotated tag: push only the tag, wait for the release workflow, verify its draft
 * (assets, bytes against a local build of the tag, attestations), publish it, then push the branch. Each step
 * checks what is already done, so `opdk release publish <version>` continues after any stop. Returns the exit code.
 */
export async function runPublish(input: PublishInput): Promise<number> {
    const { version, reporter } = input;
    const cleanups = new CleanupSet();
    const state: { stage: Stage; branch: string; interrupted: boolean; releasePublic: boolean } = { stage: "preflight", branch: "<default branch>", interrupted: false, releasePublic: false };
    const unregister = input.interrupt?.onInterrupt(() => {
        state.interrupted = true;
        const report = stopReport(state.stage, version, state.branch, { interrupted: true, releasePublic: state.releasePublic });
        reporter.failure("release", `${version}: ${report.where}`, { details: report.state, hint: `Resume with: ${report.resume}` });
        try {
            cleanups.run();
        } catch (error) {
            reporter.failure("release", `cleanup after Ctrl+C failed: ${error instanceof Error ? error.message : String(error)}`, { hint: "Remove the opdk-release-* folders from the temp directory." });
        }
        input.interrupt?.exit(INTERRUPTED_EXIT);
    });
    try {
        await flow(input, cleanups, {
            enter: (next, facts) => {
                state.stage = next;
                if (facts !== undefined) {
                    state.branch = facts.branch;
                }
            },
            releaseIsPublic: () => {
                state.releasePublic = true;
            },
        });
        return state.interrupted ? INTERRUPTED_EXIT : 0;
    } catch (error) {
        if (state.interrupted) {
            return INTERRUPTED_EXIT;
        }
        const report = stopReport(state.stage, version, state.branch, { interrupted: false, releasePublic: state.releasePublic });
        if (error instanceof StepFailure) {
            reporter.failure("release", `${version}: ${error.message}`, { details: error.details, hint: error.hint });
        } else {
            reporter.failure("release", `${version}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const resumable = !(error instanceof StepFailure) || error.resumable;
        reporter.failure("release", `${report.where}.`, { details: report.state, hint: resumable ? `Resume with: ${report.resume}` : "Resuming would stop at the same place. Fix the cause and release a new version: opdk release patch" });
        return 1;
    } finally {
        unregister?.();
        try {
            cleanups.run();
        } catch (error) {
            reporter.warn("release", `could not remove a temp folder: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

interface Progress {
    enter(stage: Stage, facts?: TagFacts): void;
    /** The release is public on GitHub; every later stop says so. */
    releaseIsPublic(): void;
}

async function flow(input: PublishInput, cleanups: CleanupSet, progress: Progress): Promise<void> {
    const { version, reporter, run, gh, clock } = input;

    progress.enter("preflight");
    const facts = await readTagFacts({ run, version, defaultBranchOverride: input.defaultBranch });
    progress.enter("preflight", facts);
    reporter.info("git", `tag ${version} at ${facts.commit.slice(0, 7)}, branch ${facts.branch}`);

    progress.enter("gh");
    const { slug, permission } = await checkGhAccess(run, gh);
    const repo = slugText(slug);
    reporter.success("gh", `${repo}: signed in, ${permission.toLowerCase()} access`);

    progress.enter("tag");
    const pushed = await pushTag(run, facts);
    reporter.success("git", pushed === "pushed" ? `pushed the tag ${version} (only the tag; the branch waits for the release)` : `the tag ${version} is already on origin`);

    progress.enter("release-lookup");
    let release = await fetchRelease(gh, slug, version);
    let runUrl: string | undefined;
    if (release !== undefined && !release.draft) {
        progress.releaseIsPublic();
    }
    if (release === undefined || release.draft) {
        progress.enter("workflow");
        const finished = await waitForWorkflow({ gh, slug, version, commit: facts.commit, reporter, clock, timeoutMs: input.timeoutMs, appearMs: input.appearMs, pollMs: input.pollMs });
        runUrl = finished.url;
        release = await findDraft(gh, slug, version, clock);
    } else {
        reporter.info("wait", `the release ${version} is already public, so the workflow is not waited for`);
    }

    progress.enter("verify");
    const local = await input.buildTagged(cleanups);
    const dir = mkdtempSync(path.join(realpathSync(tmpdir()), "opdk-release-assets-"));
    cleanups.add(() => {
        rmSync(dir, { recursive: true, force: true });
    });
    await verifyRelease({ gh, slug, facts, release, local, zip: input.zip, dir, reporter });

    progress.enter("publish");
    const wasDraft = release.draft;
    if (wasDraft) {
        await gh.text(["release", "edit", version, "--repo", repo, "--draft=false", "--latest"]);
        const after = await fetchRelease(gh, slug, version);
        if (after === undefined || after.draft) {
            throw new StepFailure(`the release ${version} is still a draft after publishing.`, `Open ${release.url} and publish it by hand, then run \`opdk release publish ${version}\` to push the branch.`);
        }
        release = after;
        progress.releaseIsPublic();
    }
    progress.enter("latest");
    const latest = await confirmLatest(gh, slug, version, clock);
    if (!latest.isLatest && wasDraft) {
        throw new StepFailure(`the release ${version} is public but ${describeLatest(latest.seen)}.`, `Mark it as latest at ${release.url} (Edit, then "Set as the latest release"), then run \`opdk release publish ${version}\`.`);
    }
    if (!latest.isLatest) {
        reporter.warn("release", `${describeLatest(latest.seen)}, not ${version}.`);
    }
    reporter.success("release", `${version} is public${latest.isLatest ? " and the latest release" : ""}: ${release.url}`);

    progress.enter("branch");
    const pushedBranch = await pushBranch(run, facts);
    reporter.success("git", pushedBranch === "pushed" ? `pushed the release commit to ${facts.branch} (no force)` : `${facts.branch} on origin already holds the release commit`);

    summary(reporter, { repo, version, release, runUrl, branch: facts.branch });
}

async function findDraft(gh: RunGh, slug: RepoSlug, version: string, clock: Clock): Promise<ReleaseInfo> {
    for (let attempt = 0; attempt < 6; attempt++) {
        const release = await fetchRelease(gh, slug, version);
        if (release !== undefined) {
            return release;
        }
        await clock.sleep(5_000);
    }
    throw new StepFailure(`the workflow succeeded but there is no release for ${version}.`, "The release job's last step creates a draft release; read the run log. Fix the cause, then release a new patch version.", [], false);
}

function summary(reporter: Reporter, { repo, version, release, runUrl, branch }: { repo: string; version: string; release: ReleaseInfo; runUrl: string | undefined; branch: string }): void {
    reporter.success("release", `${repo} ${version} released`);
    reporter.info("release", `release   ${release.url}`);
    if (runUrl !== undefined) {
        reporter.info("release", `workflow  ${runUrl}`);
    }
    reporter.info("release", `branch    ${branch} pushed; Obsidian now reads ${version} from its manifest.json`);
}

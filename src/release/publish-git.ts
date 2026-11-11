import type { RunGit } from "./git.js";
import { tryGit } from "./git.js";
import { asRecord } from "./json.js";
import { StepFailure } from "./publish-state.js";

/** What the push flow needs to know about the local tag. */
export interface TagFacts {
    readonly version: string;
    /** The id of the annotated tag object, what `ls-remote` shows on origin. */
    readonly tagObject: string;
    /** The commit the tag points at. */
    readonly commit: string;
    readonly branch: string;
    /** `id` of the manifest committed at the tag. */
    readonly pluginId: string;
}

export interface TagFactsInput {
    readonly run: RunGit;
    readonly version: string;
    readonly defaultBranchOverride: string | undefined;
}

/**
 * Judges the local tag before anything is pushed: it exists, it is annotated, its manifest holds the same version,
 * the default branch is known and contains the tagged commit. The workflow refuses a tag that fails the second or
 * the last of these, so catching them here saves a pushed tag that cannot be undone.
 */
export async function readTagFacts({ run, version, defaultBranchOverride }: TagFactsInput): Promise<TagFacts> {
    const ref = `refs/tags/${version}`;
    const tagObject = await tryGit(run, ["rev-parse", "--verify", "--quiet", ref]);
    const commit = await tryGit(run, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (tagObject === undefined || commit === undefined || tagObject === "") {
        throw new StepFailure(`there is no local tag ${version}.`, `Cut the release first with \`opdk release <patch|minor|major>\`, or pass the version of an existing tag: \`opdk release publish X.Y.Z\`.`);
    }
    if ((await tryGit(run, ["cat-file", "-t", ref])) !== "tag") {
        throw new StepFailure(`the tag ${version} is a lightweight tag.`, `Release tags are annotated. Tags are never moved, so pick a new version with \`opdk release <patch|minor|major>\`.`, [], false);
    }
    const manifestText = await tryGit(run, ["show", `${ref}:manifest.json`]);
    let manifest: Record<string, unknown> | undefined;
    try {
        manifest = manifestText === undefined ? undefined : asRecord(JSON.parse(manifestText));
    } catch {
        manifest = undefined;
    }
    if (manifest === undefined) {
        throw new StepFailure(`manifest.json at the tag ${version} is missing or not valid JSON.`, "Tags are never moved: fix it and release a new version with `opdk release patch`.", [], false);
    }
    if (manifest.version !== version) {
        throw new StepFailure(`the tag ${version} holds a manifest.json with version ${String(manifest.version)}.`, "Obsidian looks for a release tagged exactly like the manifest version. Tags are never moved: release a new version with `opdk release patch`.", [], false);
    }
    const symbolic = defaultBranchOverride === undefined ? await tryGit(run, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]) : undefined;
    const branch = defaultBranchOverride ?? symbolic?.replace(/^refs\/remotes\/origin\//, "");
    if (branch === undefined || branch === "") {
        throw new StepFailure("the default branch is unknown: origin/HEAD is not set.", "Run `git remote set-head origin --auto`, or set release.defaultBranch in opdk.config.mjs.");
    }
    if ((await tryGit(run, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) === undefined) {
        throw new StepFailure(`there is no local branch ${branch}.`, `Switch to it with \`git switch ${branch}\` and rerun.`);
    }
    if ((await tryGit(run, ["merge-base", "--is-ancestor", commit, `refs/heads/${branch}`])) === undefined) {
        throw new StepFailure(`the tag ${version} is not on ${branch}: ${branch} does not contain its commit.`, `The release commit must be part of ${branch}. Merge or cherry-pick it there, or release a new version from ${branch}.`);
    }
    const id = manifest.id;
    return { version, tagObject, commit, branch, pluginId: typeof id === "string" ? id : "plugin" };
}

/** Where the tag is on origin: not there, there with the same tag object, or there pointing elsewhere. */
export type RemoteTag = "absent" | "same" | "different";

export async function remoteTagState(run: RunGit, facts: TagFacts): Promise<RemoteTag> {
    const ref = `refs/tags/${facts.version}`;
    const listed = await run(["ls-remote", "--tags", "origin", ref]);
    const line = listed.split("\n").find((entry) => entry.endsWith(`\t${ref}`));
    if (line === undefined) {
        return "absent";
    }
    return line.startsWith(`${facts.tagObject}\t`) ? "same" : "different";
}

/** Pushes the tag, and only the tag. No force flag exists in this module: a tag on origin is never overwritten. */
export async function pushTag(run: RunGit, facts: TagFacts): Promise<"pushed" | "already-there"> {
    const state = await remoteTagState(run, facts);
    if (state === "different") {
        throw new StepFailure(`origin already has a tag ${facts.version} that points elsewhere.`, "Tags are never moved or deleted. Pick a version above the latest tag with `opdk release patch` (or minor, major).", [], false);
    }
    if (state === "same") {
        return "already-there";
    }
    await run(["push", "origin", `refs/tags/${facts.version}`]);
    return "pushed";
}

const REJECTED = /rejected|non-fast-forward|fetch first|failed to push some refs/i;

/**
 * Pushes the release commit to the default branch without force, not the local branch tip: later local commits are
 * not part of the release and stay local. When origin's branch already is that commit or contains it (an earlier run
 * got as far, or the merge was pushed by hand after a rejection), nothing is pushed. The release is public by now, so
 * a rejection (somebody pushed meanwhile) is reported as such, with the way out that keeps the tagged commit in the
 * history.
 */
export async function pushBranch(run: RunGit, facts: TagFacts): Promise<"pushed" | "already-there"> {
    const listed = await run(["ls-remote", "origin", `refs/heads/${facts.branch}`]);
    const remoteTip = listed.split("\n").find((entry) => entry.endsWith(`\trefs/heads/${facts.branch}`))?.split("\t")[0];
    if (remoteTip !== undefined && (remoteTip === facts.commit || (await tryGit(run, ["merge-base", "--is-ancestor", facts.commit, remoteTip])) !== undefined)) {
        return "already-there";
    }
    try {
        await run(["push", "origin", `${facts.commit}:refs/heads/${facts.branch}`]);
        return "pushed";
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (REJECTED.test(message)) {
            throw new StepFailure(
                `origin rejected the push of ${facts.branch}: it has commits that are not here. The release ${facts.version} is already public.`,
                `Merge them without rewriting the release commit: \`git pull --no-rebase origin ${facts.branch}\`, then \`git push origin ${facts.branch}\`. The manifest on ${facts.branch} must reach the version ${facts.version} for Obsidian to offer it.`,
                [message],
            );
        }
        throw new StepFailure(`could not push ${facts.branch}: ${message}`, `The release ${facts.version} is already public. Fix the problem above and run \`git push origin ${facts.branch}\`.`);
    }
}

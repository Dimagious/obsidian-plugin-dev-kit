import type { RepoFacts } from "./git.js";
import { unreleasedProblem } from "./changelog.js";

/** One reason the release cannot start, with what to do about it. */
export interface PreflightProblem {
    readonly message: string;
    readonly hint: string;
}

const MAX_LISTED = 5;

/** Judges the repository state. Pure: `collectFacts` reads the repository, this decides. */
export function preflightProblems(facts: RepoFacts, version: string): PreflightProblem[] {
    if (!facts.insideRepo) {
        return [{ message: "this folder is not inside a git repository.", hint: "Run opdk from the plugin repository." }];
    }
    const problems: PreflightProblem[] = [];
    if (facts.dirty.length > 0) {
        const listed = facts.dirty.slice(0, MAX_LISTED).join(", ");
        const more = facts.dirty.length > MAX_LISTED ? ` and ${String(facts.dirty.length - MAX_LISTED)} more` : "";
        problems.push({ message: `the working tree is not clean (${listed}${more}).`, hint: "Commit or discard the changes first: a release commit contains only the version bump." });
    }
    if (!facts.hasOrigin) {
        problems.push({ message: 'the repository has no remote called "origin".', hint: "Add it with `git remote add origin <url>`: the check for an existing tag and for new commits needs it." });
    }
    problems.push(...branchProblems(facts));
    if (facts.localTag) {
        problems.push({ message: `the tag ${version} already exists locally.`, hint: "Tags are never moved or deleted. Pick a version above the latest tag." });
    }
    if (facts.remoteTag === "present") {
        problems.push({ message: `the tag ${version} already exists on origin.`, hint: "Tags are never moved or deleted. Pick a version above the latest tag." });
    } else if (facts.remoteTag === "unreachable") {
        problems.push({ message: `could not ask origin for the tag ${version}: ${facts.remoteTagError ?? "unknown error"}`, hint: "Check the network and your access to origin, then rerun." });
    }
    return problems;
}

function branchProblems(facts: RepoFacts): PreflightProblem[] {
    const problems: PreflightProblem[] = [];
    if (facts.defaultBranch === undefined) {
        if (facts.hasOrigin) {
            problems.push({
                message: "the default branch is unknown: origin/HEAD is not set.",
                hint: 'Run `git remote set-head origin --auto`, or set release.defaultBranch in opdk.config.mjs.',
            });
        }
        return problems;
    }
    if (facts.branch !== facts.defaultBranch) {
        problems.push({ message: `releases are cut from ${facts.defaultBranch}, but this is ${facts.branch ?? "a detached HEAD"}.`, hint: `Switch with \`git switch ${facts.defaultBranch}\`.` });
    }
    if (facts.fetchError !== undefined) {
        problems.push({ message: `could not fetch origin: ${facts.fetchError}`, hint: "Check the network and your access to origin, then rerun." });
    } else if (facts.behind === undefined) {
        problems.push({ message: `origin has no branch ${facts.defaultBranch} to compare with.`, hint: `Push ${facts.defaultBranch} once, or set release.defaultBranch in opdk.config.mjs.` });
    } else if (facts.behind > 0) {
        problems.push({ message: `${facts.defaultBranch} is ${String(facts.behind)} commit(s) behind origin/${facts.defaultBranch}.`, hint: "Run `git pull --ff-only` first." });
    }
    // The tag is pushed before the branch, so the commits behind it would reach the release workflow without ever having run in branch CI.
    if (facts.fetchError === undefined && facts.branch === facts.defaultBranch && facts.ahead !== undefined && facts.ahead > 0) {
        problems.push({
            message: `${facts.defaultBranch} is ${String(facts.ahead)} commit(s) ahead of origin/${facts.defaultBranch}: CI has not seen them, and the release would tag them.`,
            hint: "Push them through a pull request first, wait for CI, pull, and rerun.",
        });
    }
    return problems;
}

/** The changelog part of preflight, kept next to the repository part so the bump reports both together. */
export function changelogPreflight(text: string | undefined, file: string): PreflightProblem[] {
    const problem = unreleasedProblem(text, file);
    return problem === undefined ? [] : [{ message: problem, hint: "The release notes come from [Unreleased]; write them before releasing." }];
}

import { describe, expect, it } from "vitest";
import type { RepoFacts } from "./git.js";
import { changelogPreflight, preflightProblems, unpushedWarning } from "./preflight.js";

const READY: RepoFacts = {
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
};
const messages = (changes: Partial<RepoFacts>): string[] => preflightProblems({ ...READY, ...changes }, "1.1.0").map((problem) => problem.message);

describe("preflightProblems", () => {
    it("finds nothing wrong with a clean checkout of the default branch", () => {
        expect(messages({})).toEqual([]);
    });

    it("stops at a folder that is not a repository", () => {
        expect(messages({ insideRepo: false, branch: undefined })).toEqual(["this folder is not inside a git repository."]);
    });

    it("lists the dirty files, five at most", () => {
        expect(messages({ dirty: [" M a.ts", "?? b.ts"] })).toEqual(["the working tree is not clean ( M a.ts, ?? b.ts)."]);
        const many = Array.from({ length: 8 }, (_, index) => `?? f${String(index)}`);
        expect(messages({ dirty: many })[0]).toContain("and 3 more");
    });

    it("requires an origin", () => {
        expect(messages({ hasOrigin: false, defaultBranch: undefined })).toEqual(['the repository has no remote called "origin".']);
    });

    it("explains an unknown default branch", () => {
        const [problem] = preflightProblems({ ...READY, defaultBranch: undefined }, "1.1.0");
        expect(problem?.message).toContain("origin/HEAD is not set");
        expect(problem?.hint).toContain("release.defaultBranch");
    });

    it("requires the default branch and names the one it is on", () => {
        expect(messages({ branch: "feat/x" })).toEqual(["releases are cut from main, but this is feat/x."]);
        expect(messages({ branch: undefined })).toEqual(["releases are cut from main, but this is a detached HEAD."]);
    });

    it("fails when behind origin, and when the fetch or the comparison failed", () => {
        expect(messages({ behind: 2 })).toEqual(["main is 2 commit(s) behind origin/main."]);
        expect(messages({ fetchError: "unreachable" })).toEqual(["could not fetch origin: unreachable"]);
        expect(messages({ behind: undefined, ahead: undefined })[0]).toContain("origin has no branch main");
    });

    it("fails on a tag that exists locally or on origin, and on an origin it cannot ask", () => {
        expect(messages({ localTag: true })).toEqual(["the tag 1.1.0 already exists locally."]);
        expect(messages({ remoteTag: "present" })).toEqual(["the tag 1.1.0 already exists on origin."]);
        expect(messages({ remoteTag: "unreachable", remoteTagError: "timeout" })).toEqual(["could not ask origin for the tag 1.1.0: timeout"]);
    });

    it("reports several problems together", () => {
        expect(messages({ dirty: ["?? x"], branch: "dev", localTag: true })).toHaveLength(3);
    });
});

describe("unpushedWarning", () => {
    it("warns about commits origin lacks, and only then", () => {
        expect(unpushedWarning({ ...READY, ahead: 3 })).toContain("3 commit(s) ahead of origin/main");
        expect(unpushedWarning(READY)).toBeUndefined();
        expect(unpushedWarning({ ...READY, ahead: undefined })).toBeUndefined();
    });
});

describe("changelogPreflight", () => {
    it("turns the changelog problem into a preflight problem", () => {
        expect(changelogPreflight("## [Unreleased]\n\n- A.\n", "CHANGELOG.md")).toEqual([]);
        expect(changelogPreflight(undefined, "CHANGELOG.md")[0]?.message).toContain("is missing");
    });
});

import { describe, expect, it } from "vitest";
import { FakeGithub } from "../test-support/fake-github.js";
import { checkGhAccess, originSlug } from "./gh-access.js";
import type { RunGit } from "./git.js";
import { StepFailure } from "./publish-state.js";

const origin = (url: string | Error): RunGit => (args) => {
    if (args.join(" ") !== "config --get remote.origin.url") {
        return Promise.reject(new Error(`unexpected git ${args.join(" ")}`));
    }
    return url instanceof Error ? Promise.reject(url) : Promise.resolve(`${url}\n`);
};

describe("originSlug", () => {
    it("reads the configured URL", async () => {
        expect(await originSlug(origin("git@github.com:Dimagious/snipsy.git"))).toEqual({ owner: "Dimagious", repo: "snipsy" });
    });

    it("fails with a fix when there is no origin or it is not a GitHub URL", async () => {
        await expect(originSlug(origin(new Error("exit 1")))).rejects.toThrow('no remote called "origin"');
        await expect(originSlug(origin("/srv/git/origin.git"))).rejects.toMatchObject({ message: "origin (/srv/git/origin.git) does not look like a GitHub repository URL.", hint: expect.stringContaining("github.com") as unknown });
    });
});

describe("checkGhAccess", () => {
    it.each(["WRITE", "MAINTAIN", "ADMIN"])("accepts %s", async (permission) => {
        const github = new FakeGithub("a/b");
        github.permission = permission;
        expect(await checkGhAccess(origin("https://github.com/a/b.git"), github)).toEqual({ slug: { owner: "a", repo: "b" }, permission });
        expect(github.calls).toEqual(["repo view a/b --json nameWithOwner,viewerPermission"]);
    });

    it.each(["READ", "TRIAGE", ""])("refuses %j", async (permission) => {
        const github = new FakeGithub("a/b");
        github.permission = permission;
        const error: unknown = await checkGhAccess(origin("https://github.com/a/b.git"), github).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(StepFailure);
        expect((error as StepFailure).message).toContain("releasing needs write access");
    });

    it("maps a missing gh to the install hint and any other failure to the sign-in hint", async () => {
        const missing = new FakeGithub("a/b");
        missing.repoError = new Error("gh is not installed or not on PATH. whatever");
        await expect(checkGhAccess(origin("https://github.com/a/b.git"), missing)).rejects.toMatchObject({ message: "the GitHub CLI (gh) is not installed.", hint: expect.stringContaining("gh auth login") as unknown });
        const signedOut = new FakeGithub("a/b");
        signedOut.repoError = new Error("To get started with GitHub CLI, please run: gh auth login");
        await expect(checkGhAccess(origin("https://github.com/a/b.git"), signedOut)).rejects.toMatchObject({ message: expect.stringContaining("gh cannot see a/b") as unknown, hint: expect.stringContaining("gh auth switch") as unknown });
    });
});

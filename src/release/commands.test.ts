import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext } from "../test-support/plugin-fixture.js";
import { createReleaseRepo, type ReleaseRepo } from "../test-support/release-fixture.js";
import { releaseCommand, releaseCommands } from "./commands.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: ReleaseRepo | undefined;
afterEach(() => {
    repo?.cleanup();
    repo = undefined;
});

describe("registration", () => {
    it("exposes release", () => {
        expect(releaseCommands.map((command) => command.name)).toEqual(["release"]);
    });

    it("documents the checks, the skip flags, the bump and the push flow", () => {
        for (const word of ["opdk release check", "--tag", "--no-build", "--no-reproducible", "--no-api", "--dry-run", "versions.json", "reproducible", "obsidianmd/no-unsupported-api", "--no-push", "opdk release publish", "opdk release notes", "refs/tags/X.Y.Z", "never with force", "gh attestation verify", "byte for byte", "--timeout", "--zip", "release.defaultBranch", "defaultBranch", "git archive HEAD", "committed tree", "Node or esbuild version", "line endings", "pnpm and", "Git LFS", "Blind spot", "paths", "scripts.build", "build:plugin", "Ctrl+C", "130", "author, minAppVersion and isDesktopOnly are required", "helpUrl", "warning, as in the official action", "gh is never called", "it does fetch from origin"]) {
            expect(releaseCommand.usage.replace(/\s+/g, " "), word).toContain(word);
        }
    });
});

describe("opdk release", () => {
    it("rejects bad arguments before touching anything", async () => {
        const ctx = createContext("/nonexistent");
        await expect(releaseCommand.run([], ctx)).rejects.toThrow(/needs "check"/);
        await expect(releaseCommand.run(["v1.0.0"], ctx)).rejects.toThrow(/without the "v"/);
    });

    it("check reads the tag from GITHUB_REF_NAME when the run is for a tag", async () => {
        repo = createReleaseRepo();
        const ctx = createContext(repo.dir, { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "1.0.1" });
        expect(await releaseCommand.run(["check", "--no-build", "--no-api"], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain('tag "1.0.1" does not match manifest.json version 1.0.0.');

        const branch = createContext(repo.dir, { GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" });
        expect(await releaseCommand.run(["check", "--no-build", "--no-api"], branch)).toBe(0);
    });

    it("check --tag beats the environment", async () => {
        repo = createReleaseRepo();
        const ctx = createContext(repo.dir, { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "9.9.9" });
        expect(await releaseCommand.run(["check", "--tag", "1.0.0", "--no-build", "--no-api"], ctx)).toBe(0);
    });

    it("loads the release section of opdk.config.mjs", async () => {
        repo = createReleaseRepo();
        repo.write("opdk.config.mjs", 'export default { release: { changelog: "HISTORY.md" } };\n');
        const ctx = createContext(repo.dir);
        expect(await releaseCommand.run(["check", "--no-build", "--no-api"], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("changelog: HISTORY.md is missing.");
    });

    it("bumps with --dry-run through the real git and prints the diff", async () => {
        repo = createReleaseRepo();
        const ctx = createContext(repo.dir);
        expect(await releaseCommand.run(["patch", "--dry-run", "--no-build", "--no-api"], ctx)).toBe(0);
        expect(ctx.out.join("")).toContain('+  "version": "1.0.1"');
        expect(repo.git("status", "--porcelain")).toBe("");
    });

    it("hands the CLI's Ctrl+C hook to the check and to the bump, and removes the listener afterwards", async () => {
        repo = createReleaseRepo();
        const off = vi.fn();
        const onInterrupt = vi.fn(() => off);
        const check = createContext(repo.dir, {}, onInterrupt);
        expect(await releaseCommand.run(["check", "--no-build", "--no-api"], check)).toBe(0);
        expect(onInterrupt).toHaveBeenCalledOnce();
        expect(off).toHaveBeenCalledOnce();

        const bump = createContext(repo.dir, {}, onInterrupt);
        expect(await releaseCommand.run(["patch", "--dry-run", "--no-build", "--no-api"], bump)).toBe(0);
        expect(onInterrupt).toHaveBeenCalledTimes(2);
        expect(off).toHaveBeenCalledTimes(2);
    });
});

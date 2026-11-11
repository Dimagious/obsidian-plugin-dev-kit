import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext } from "../test-support/plugin-fixture.js";
import { createReleaseRepo, type ReleaseRepo } from "../test-support/release-fixture.js";
import { releaseCommand } from "./commands.js";
import { changelogNotes } from "./publish-command.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let repo: ReleaseRepo | undefined;
let bin: string | undefined;
const savedPath = process.env.PATH;
afterEach(() => {
    repo?.cleanup();
    repo = undefined;
    process.env.PATH = savedPath;
    if (bin !== undefined) {
        rmSync(bin, { recursive: true, force: true });
        bin = undefined;
    }
});

/** Puts a `gh` that always fails (as when nobody is signed in) first on PATH, for the real runner the command builds. */
function signedOutGh(): void {
    bin = mkdtempSync(path.join(tmpdir(), "opdk-signed-out-gh-"));
    writeFileSync(path.join(bin, "gh"), '#!/bin/sh\necho "To get started with GitHub CLI, please run: gh auth login" >&2\nexit 4\n');
    chmodSync(path.join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}:${savedPath ?? ""}`;
}

describe("changelogNotes", () => {
    it("returns the body of the section of the given version, or of the manifest version", () => {
        repo = createReleaseRepo();
        expect(changelogNotes(repo.dir, {}, "1.0.0")).toBe("### Added\n\n- First release.\n");
        expect(changelogNotes(repo.dir, {}, undefined)).toBe("### Added\n\n- First release.\n");
    });

    it("reads the changelog the config names", () => {
        repo = createReleaseRepo();
        repo.write("HISTORY.md", "# History\n\n## [1.0.0] - 2026-01-01\n\n- From history.\n");
        expect(changelogNotes(repo.dir, { release: { changelog: "HISTORY.md" } }, "1.0.0")).toBe("- From history.\n");
    });

    it("fails with the fix for a missing section, an empty section and a missing file", () => {
        repo = createReleaseRepo();
        expect(() => changelogNotes(repo?.dir ?? "", {}, "2.0.0")).toThrow('CHANGELOG.md has no "## [2.0.0]" section. Move the entries of "## [Unreleased]" under it');
        repo.write("CHANGELOG.md", "## [1.0.0] - 2026-01-01\n\n## [0.9.0] - 2025-01-01\n\n- x\n");
        expect(() => changelogNotes(repo?.dir ?? "", {}, "1.0.0")).toThrow('The "## [1.0.0]" section of CHANGELOG.md is empty.');
        expect(() => changelogNotes(repo?.dir ?? "", { release: { changelog: "NOPE.md" } }, "1.0.0")).toThrow(/Cannot read NOPE\.md: .*Run opdk from the plugin root/);
    });

    it("needs a manifest when no version is given", () => {
        repo = createReleaseRepo();
        repo.write("manifest.json", "{}");
        expect(() => changelogNotes(repo?.dir ?? "", {}, undefined)).toThrow("manifest.json is missing, not valid or has no version");
    });
});

describe("opdk release notes", () => {
    it("prints the body on stdout and nothing else", async () => {
        repo = createReleaseRepo();
        const ctx = createContext(repo.dir);
        expect(await releaseCommand.run(["notes", "1.0.0"], ctx)).toBe(0);
        expect(ctx.out.join("")).toBe("### Added\n\n- First release.\n");
        expect(ctx.err.join("")).toBe("");
    });

    it("fails for a version without a section", async () => {
        repo = createReleaseRepo();
        await expect(releaseCommand.run(["notes", "3.0.0"], createContext(repo.dir))).rejects.toThrow('has no "## [3.0.0]" section');
    });
});

describe("opdk release publish", () => {
    it("fails before any remote call when there is no such tag", async () => {
        repo = createReleaseRepo();
        const ctx = createContext(repo.dir);
        expect(await releaseCommand.run(["publish", "1.0.1"], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("there is no local tag 1.0.1.");
        expect(ctx.err.join("")).toContain("Resume with: opdk release publish 1.0.1");
        expect(repo.originGit("tag", "-l").trim()).toBe("1.0.0");
    });

    it("defaults to the manifest version and reports the Ctrl+C hook it was given", async () => {
        repo = createReleaseRepo();
        const off = vi.fn();
        const ctx = createContext(repo.dir, {}, () => off);
        repo.git("tag", "-d", "1.0.0");
        expect(await releaseCommand.run(["publish"], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("1.0.0: there is no local tag 1.0.0.");
        expect(off).toHaveBeenCalledOnce();
    });
});

describe.skipIf(process.platform === "win32")("the push flow through the command", () => {
    it("opdk release <bump> stops before changing anything when gh is not signed in, and --no-push does not need gh", async () => {
        repo = createReleaseRepo();
        repo.git("config", "remote.origin.url", "https://github.com/example/fixture.git");
        repo.git("config", `url.${repo.origin}.insteadOf`, "https://github.com/example/fixture.git");
        signedOutGh();
        const ctx = createContext(repo.dir);
        expect(await releaseCommand.run(["patch", "--no-build", "--no-api"], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("gh cannot see example/fixture");
        expect(ctx.err.join("")).toContain("gh auth login");
        expect(repo.git("status", "--porcelain")).toBe("");
        expect(repo.git("tag", "-l")).toBe("1.0.0\n");

        const local = createContext(repo.dir);
        expect(await releaseCommand.run(["patch", "--no-build", "--no-api", "--no-push"], local)).toBe(0);
        expect(local.out.join("")).toContain("nothing was pushed (--no-push)");
        expect(repo.git("tag", "-l")).toBe("1.0.0\n1.0.1\n");
    });

    it("opdk release publish reports a gh that cannot see the repository and pushes nothing", async () => {
        repo = createReleaseRepo();
        expect(await releaseCommand.run(["patch", "--no-build", "--no-api", "--no-push"], createContext(repo.dir))).toBe(0);
        repo.git("config", "remote.origin.url", "git@github.com:example/fixture.git");
        signedOutGh();
        const ctx = createContext(repo.dir);
        expect(await releaseCommand.run(["publish", "1.0.1"], ctx)).toBe(1);
        expect(ctx.err.join("")).toContain("gh cannot see example/fixture");
        expect(repo.originGit("tag", "-l").trim()).toBe("1.0.0");
    });
});

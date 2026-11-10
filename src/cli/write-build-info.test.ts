import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spawns git and node several times per test: misses the 5 s default when suites share the machine (seen once in a full run).
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
        cwd,
        env,
        encoding: "utf8",
    }).trim();
}

/** Runs the real script copied into `<dir>/scripts`, so it sees `dir` as the kit root. Returns dist/build-info.json. */
function runScript(dir: string): { commit?: string } {
    const result = spawnSync("node", [path.join(dir, "scripts", "write-build-info.mjs")], { cwd: dir, env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(readFileSync(path.join(dir, "dist", "build-info.json"), "utf8")) as { commit?: string };
}

describe("scripts/write-build-info.mjs", () => {
    let base: string;
    let dir: string;

    /** A kit-shaped tree: the script plus the placeholder file, exactly as committed. */
    function populate(target: string): void {
        mkdirSync(path.join(target, "scripts"), { recursive: true });
        for (const file of ["write-build-info.mjs", "archive-commit"]) {
            copyFileSync(path.join(kitRoot, "scripts", file), path.join(target, "scripts", file));
        }
        copyFileSync(path.join(kitRoot, ".gitattributes"), path.join(target, ".gitattributes"));
    }

    beforeEach(() => {
        base = realpathSync(mkdtempSync(path.join(tmpdir(), "opdk-buildinfo-")));
        dir = path.join(base, "kit");
        populate(dir);
    });
    afterEach(() => {
        rmSync(base, { recursive: true, force: true });
    });

    function commitAll(target: string): string {
        git(target, "init", "-q");
        git(target, "add", "-A");
        git(target, "commit", "-q", "-m", "init");
        return git(target, "rev-parse", "--short", "HEAD");
    }

    it("tracks the placeholder with export-subst, as committed", () => {
        expect(readFileSync(path.join(kitRoot, "scripts", "archive-commit"), "utf8").trim()).toBe("$Format:%h$");
        expect(readFileSync(path.join(kitRoot, ".gitattributes"), "utf8")).toContain("scripts/archive-commit export-subst");
    });

    it("embeds the short commit of a clean checkout", () => {
        const sha = commitAll(dir);
        expect(runScript(dir)).toEqual({ commit: sha });
    });

    it("adds -dirty when the working tree has uncommitted changes", () => {
        const sha = commitAll(dir);
        writeFileSync(path.join(dir, "scripts", "archive-commit"), "changed\n");
        expect(runScript(dir)).toEqual({ commit: `${sha}-dirty` });
    });

    it("reads the commit git substituted into a git archive tarball without .git", () => {
        const sha = commitAll(dir);
        const extracted = path.join(base, "extracted");
        mkdirSync(extracted);
        const tarball = path.join(base, "kit.tar");
        git(dir, "archive", "--format=tar", "-o", tarball, "HEAD");
        execFileSync("tar", ["-x", "-f", tarball, "-C", extracted]);
        expect(readFileSync(path.join(extracted, "scripts", "archive-commit"), "utf8").trim()).toMatch(/^[0-9a-f]{7,64}$/);
        expect(runScript(extracted)).toEqual({ commit: sha });
    });

    it("leaves the commit out when there is no git and the file is still the placeholder", () => {
        expect(runScript(dir)).toEqual({});
    });

    it("rejects an archive-commit file that is not a hash", () => {
        writeFileSync(path.join(dir, "scripts", "archive-commit"), "abc\n");
        expect(runScript(dir)).toEqual({});
        writeFileSync(path.join(dir, "scripts", "archive-commit"), "ABCDEF1234\n");
        expect(runScript(dir)).toEqual({});
    });

    it("leaves the commit out when archive-commit is missing", () => {
        rmSync(path.join(dir, "scripts", "archive-commit"));
        expect(runScript(dir)).toEqual({});
    });

    it("ignores the commit of an enclosing repository the kit is only a folder of", () => {
        // base is the repository, dir (a subfolder) is the "kit": its toplevel differs, so the commit is not its own.
        const sha = commitAll(base);
        expect(sha).not.toBe("");
        expect(runScript(dir)).toEqual({});
    });

    it("uses the archive commit when the kit sits inside an unrelated repository", () => {
        commitAll(base);
        writeFileSync(path.join(dir, "scripts", "archive-commit"), "abcdef1\n");
        expect(runScript(dir)).toEqual({ commit: "abcdef1" });
    });

    it("leaves the commit out in a repository without commits", () => {
        git(dir, "init", "-q");
        expect(runScript(dir)).toEqual({});
    });
});

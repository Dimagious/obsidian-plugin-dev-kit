import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackAll } from "../test-support/git.js";
import { gitFreeEnvironment, listTrackedFiles, parseLsFiles } from "./git-files.js";

// Real ESLint, git and esbuild runs: they miss the 5 s default when suites share the machine. Per file, so the global default stays.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe("parseLsFiles", () => {
    it("splits on NUL and drops the empty entry after the last one", () => {
        expect(parseLsFiles("a.ts\0src/b.ts\0")).toEqual(["a.ts", "src/b.ts"]);
    });

    it("returns nothing for empty output", () => {
        expect(parseLsFiles("")).toEqual([]);
    });

    it("keeps spaces and newlines inside a name", () => {
        expect(parseLsFiles("a b.ts\0odd\nname.ts\0")).toEqual(["a b.ts", "odd\nname.ts"]);
    });
});

describe("gitFreeEnvironment", () => {
    it("drops every GIT_* variable and keeps the rest", () => {
        expect(gitFreeEnvironment({ GIT_DIR: "/x/.git", GIT_WORK_TREE: "/x", GIT_INDEX_FILE: "/x/i", PATH: "/bin", GITHUB_TOKEN: "t", HOME: "/h" })).toEqual({
            PATH: "/bin",
            GITHUB_TOKEN: "t",
            HOME: "/h",
        });
    });
});

describe("listTrackedFiles", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), "opdk-git-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    const write = (relativePath: string, text = "x\n"): void => {
        const file = path.join(dir, relativePath);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, text);
    };

    it("lists tracked files with / separators and leaves untracked ones out", async () => {
        write("src/main.ts");
        write("styles.css");
        write(".gitignore", "main.js\ncoverage/\n");
        trackAll(dir);
        write("main.js", "built");
        write("coverage/lcov.info");
        write("src/new.ts");
        expect((await listTrackedFiles(dir)).sort()).toEqual([".gitignore", "src/main.ts", "styles.css"]);
    });

    it("lists files whose names have spaces and non-ASCII characters", async () => {
        write("docs/my notes.css");
        write("src/café.ts");
        trackAll(dir);
        expect((await listTrackedFiles(dir)).sort()).toEqual(["docs/my notes.css", "src/café.ts"]);
    });

    it("drops a tracked file that was deleted from the working tree", async () => {
        write("src/gone.ts");
        write("src/kept.ts");
        trackAll(dir);
        rmSync(path.join(dir, "src/gone.ts"));
        expect(await listTrackedFiles(dir)).toEqual(["src/kept.ts"]);
    });

    it("drops a tracked symlink whose target is gone", async () => {
        write("src/kept.ts");
        symlinkSync(path.join(dir, "missing-target"), path.join(dir, "dangling"));
        trackAll(dir);
        expect(await listTrackedFiles(dir)).toEqual(["src/kept.ts"]);
    });

    it("drops a tracked symlink to a file that exists", async () => {
        write("src/kept.ts");
        write("src/real.ts");
        symlinkSync(path.join(dir, "src/real.ts"), path.join(dir, "linked.ts"));
        trackAll(dir);
        expect((await listTrackedFiles(dir)).sort()).toEqual(["src/kept.ts", "src/real.ts"]);
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("names the file and the command when a tracked file cannot be inspected", async () => {
        write("locked/secret.ts");
        write("src/main.ts");
        trackAll(dir);
        chmodSync(path.join(dir, "locked"), 0o000);
        try {
            await expect(listTrackedFiles(dir)).rejects.toThrow(/opdk scan could not read .*locked.secret\.ts: EACCES/);
        } finally {
            chmodSync(path.join(dir, "locked"), 0o755);
        }
    });

    it("lists the repository in cwd even when GIT_DIR points at another one", async () => {
        const other = mkdtempSync(path.join(tmpdir(), "opdk-git-"));
        const original = process.env.GIT_DIR;
        try {
            trackAll(other);
            write("src/main.ts");
            trackAll(dir);
            process.env.GIT_DIR = path.join(other, ".git");
            expect(await listTrackedFiles(dir)).toEqual(["src/main.ts"]);
        } finally {
            if (original === undefined) {
                delete process.env.GIT_DIR;
            } else {
                process.env.GIT_DIR = original;
            }
            rmSync(other, { recursive: true, force: true });
        }
    });

    it("returns only the files below a subfolder of the repository, relative to it", async () => {
        write("root.ts");
        write("plugin/src/main.ts");
        trackAll(dir);
        expect(await listTrackedFiles(path.join(dir, "plugin"))).toEqual(["src/main.ts"]);
    });

    it("returns nothing for a repository that tracks no file", async () => {
        write("src/main.ts");
        trackAll(dir);
        rmSync(path.join(dir, "src/main.ts"));
        expect(await listTrackedFiles(dir)).toEqual([]);
    });

    it("fails with guidance outside a git repository", async () => {
        write("src/main.ts");
        await expect(listTrackedFiles(dir)).rejects.toThrow(/is not inside a git repository.*git init/);
    });

    it("fails with guidance when git is not installed", async () => {
        const original = process.env.PATH;
        process.env.PATH = "";
        try {
            await expect(listTrackedFiles(dir)).rejects.toThrow("git is not installed or not on PATH");
        } finally {
            if (original === undefined) {
                delete process.env.PATH;
            } else {
                process.env.PATH = original;
            }
        }
    });

    it("says so when the folder does not exist, not that git is missing", async () => {
        const missing = path.join(dir, "does-not-exist");
        await expect(listTrackedFiles(missing)).rejects.toThrow(`${missing} is not a folder`);
    });

    it("reports git's own message when it fails for another reason", async () => {
        writeFileSync(path.join(dir, ".git"), "garbage\n");
        await expect(listTrackedFiles(dir)).rejects.toThrow(`git ls-files failed in ${dir}: fatal: invalid gitfile format`);
    });
});

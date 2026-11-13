import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import path from "node:path";
import { createRunGit, type RunGit } from "../release/git.js";
import { gitFreeEnvironment } from "../scanner/git-files.js";
import { registerTempDir } from "./temp-registry.js";
import { testTmpRoot } from "./test-tmp.js";

export const VALID_MANIFEST = {
    id: "fixture-release",
    name: "Fixture Release",
    version: "1.0.0",
    minAppVersion: "1.5.0",
    description: "Counts the words of the current note.",
    author: "Fixture Author",
    authorUrl: "https://example.com/author",
    isDesktopOnly: false,
};

export const CHANGELOG = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "### Added",
    "",
    "- Word count in the status bar.",
    "",
    "## [1.0.0] - 2026-01-01",
    "",
    "### Added",
    "",
    "- First release.",
    "",
    "[Unreleased]: https://github.com/example/fixture/compare/1.0.0...HEAD",
    "[1.0.0]: https://github.com/example/fixture/releases/tag/1.0.0",
    "",
].join("\n");

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The files of a plugin released once, at version 1.0.0 with [Unreleased] entries waiting. */
export function writePluginFiles(target: { write(relativePath: string, content: string): void }): void {
    const write = (relativePath: string, content: string): void => {
        target.write(relativePath, content);
    };
    write("manifest.json", json(VALID_MANIFEST));
    write("package.json", json({ name: "fixture-release", version: "1.0.0", private: true, scripts: { build: "opdk build" } }));
    write("package-lock.json", json({ name: "fixture-release", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture-release", version: "1.0.0" } } }));
    write("versions.json", json({ "1.0.0": "1.5.0" }));
    write("CHANGELOG.md", CHANGELOG);
    write("src/main.ts", 'export default class FixturePlugin {\n    hello(): string {\n        return "hello";\n    }\n}\n');
    write("src/styles/main.css", ".fixture { color: red; }\n");
    write(".gitignore", "main.js\nstyles.css\nnode_modules\n");
}

/**
 * The environment every git call of a test runs in: no `GIT_*` variable of an outer hook, and neither the owner's
 * global nor the system git config. Without this a test would sign commits with the owner's GPG key and run the
 * global hooks. Production code (`createRunGit`) keeps respecting the user's config.
 */
export function hermeticGitEnv(): NodeJS.ProcessEnv {
    return { ...gitFreeEnvironment(process.env), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1" };
}

export interface ReleaseRepo {
    /** The plugin folder, a git repository on `main` whose `origin` is a bare repository next to it. */
    readonly dir: string;
    /** The bare repository acting as origin. */
    readonly origin: string;
    /** Runs git in the plugin folder and returns stdout. */
    git(...args: string[]): string;
    /** The production `RunGit` for the plugin folder, in the hermetic environment. */
    readonly run: RunGit;
    /** Runs git in the origin repository. */
    originGit(...args: string[]): string;
    write(relativePath: string, content: string): void;
    read(relativePath: string): string;
    /** Commits everything and pushes `main`. */
    commitAll(message: string): void;
    cleanup(): void;
}

/**
 * A plugin released once (1.0.0, tag pushed) in a git repository with a bare repository as `origin`, so the release
 * flow runs against real git and nothing leaves the temp folder. Remove it with `cleanup()`.
 */
export function createReleaseRepo(): ReleaseRepo {
    const root = mkdtempSync(path.join(testTmpRoot(), "opdk-release-fixture-"));
    const cleanup = registerTempDir(root);
    try {
        return buildReleaseRepo(root, cleanup);
    } catch (error) {
        cleanup();
        throw error;
    }
}

function buildReleaseRepo(root: string, cleanup: () => void): ReleaseRepo {
    const dir = path.join(root, "plugin");
    const origin = path.join(root, "origin.git");
    mkdirSync(dir);
    const env = hermeticGitEnv();
    const run = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, env, encoding: "utf8" });
    const write = (relativePath: string, content: string): void => {
        const file = path.join(dir, relativePath);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content);
    };
    run(root, ["init", "--quiet", "--bare", "-b", "main", origin]);
    run(dir, ["init", "--quiet", "-b", "main"]);
    for (const [key, value] of [["user.name", "Fixture"], ["user.email", "fixture@example.com"], ["commit.gpgsign", "false"], ["tag.gpgsign", "false"]] as const) {
        run(dir, ["config", key, value]);
    }
    run(dir, ["remote", "add", "origin", origin]);

    writePluginFiles({ write });
    run(dir, ["add", "-A"]);
    run(dir, ["commit", "--quiet", "-m", "Release 1.0.0"]);
    run(dir, ["tag", "-a", "1.0.0", "-m", "1.0.0"]);
    run(dir, ["push", "--quiet", "-u", "origin", "main", "1.0.0"]);
    run(dir, ["remote", "set-head", "origin", "main"]);

    return {
        dir,
        origin,
        run: createRunGit(dir, env),
        git: (...args) => run(dir, args),
        originGit: (...args) => run(origin, args),
        write,
        read: (relativePath) => readFileSync(path.join(dir, relativePath), "utf8"),
        commitAll: (message) => {
            run(dir, ["add", "-A"]);
            run(dir, ["commit", "--quiet", "-m", message]);
            run(dir, ["push", "--quiet", "origin", "main"]);
        },
        cleanup,
    };
}

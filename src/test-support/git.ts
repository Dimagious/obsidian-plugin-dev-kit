import { execFileSync } from "node:child_process";
import { gitFreeEnvironment } from "../scanner/git-files.js";

function git(dir: string, args: string[]): void {
    // GIT_* variables from an outer hook or worktree would point git at the wrong repository.
    execFileSync("git", args, { cwd: dir, env: gitFreeEnvironment(process.env) });
}

/** Makes `dir` a git repository that tracks nothing yet. */
export function initRepo(dir: string): void {
    git(dir, ["init", "-q"]);
}

/** Makes `dir` a git repository and stages everything in it, so `git ls-files` lists the fixture. */
export function trackAll(dir: string): void {
    initRepo(dir);
    git(dir, ["add", "-A"]);
}

import { execFile } from "node:child_process";
import { lstatSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Splits `git ls-files -z` output into paths, dropping the empty entry after the last NUL. */
export function parseLsFiles(output: string): string[] {
    return output.split("\0").filter((entry) => entry !== "");
}

/**
 * `env` without the `GIT_*` variables. A git hook or a worktree session exports `GIT_DIR`, `GIT_WORK_TREE` or
 * `GIT_INDEX_FILE`, which would point `git ls-files` at another repository than the one in `cwd`.
 */
export function gitFreeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("GIT_")));
}

/**
 * The files git tracks under `cwd`, as paths relative to it with `/` separators, minus entries that are not
 * regular files on disk (deleted in the working tree but not yet committed, submodule folders, symlinks: the
 * scanner reads the repository's files, and a link to a file outside the plugin folder is not one of them).
 * Untracked build output (`main.js`, `coverage/`, `.preview/`) never reaches the scanner, so it is not here.
 *
 * Throws, saying what to do, when git is missing or `cwd` is not inside a repository.
 */
export async function listTrackedFiles(cwd: string): Promise<string[]> {
    let stdout: string;
    try {
        ({ stdout } = await run("git", ["ls-files", "-z"], { cwd, env: gitFreeEnvironment(process.env), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    } catch (error) {
        throw new Error(describeGitFailure(error, cwd), { cause: error });
    }
    return parseLsFiles(stdout).filter((file) => isRegularFile(path.join(cwd, file)));
}

function describeGitFailure(error: unknown, cwd: string): string {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        // Node reports a missing working directory with the same code as a missing git binary.
        if (!isDirectory(cwd)) {
            return `${cwd} is not a folder, so there is nothing to scan. Run opdk from the plugin root.`;
        }
        return "git is not installed or not on PATH. opdk scan reads the files git tracks, as the scanner reads the repository.";
    }
    const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
    if (/not a git repository/i.test(stderr)) {
        return `${cwd} is not inside a git repository. opdk scan reads the files git tracks, so build output stays out of the scan: run \`git init\` and \`git add\` the plugin's files, or run opdk from the plugin repository.`;
    }
    return `git ls-files failed in ${cwd}: ${stderr === "" ? String(error) : stderr}`;
}

function isDirectory(folder: string): boolean {
    try {
        return statSync(folder).isDirectory();
    } catch (error) {
        if (isMissing(error)) {
            return false;
        }
        throw error;
    }
}

function isRegularFile(file: string): boolean {
    try {
        return lstatSync(file).isFile();
    } catch (error) {
        if (isMissing(error)) {
            return false;
        }
        throw new Error(`opdk scan could not read ${file}: ${error instanceof Error ? error.message : String(error)}. Check its permissions, or run opdk from the plugin root.`, { cause: error });
    }
}

function isMissing(error: unknown): boolean {
    return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

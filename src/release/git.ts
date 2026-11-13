import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runs `git <args>` in the plugin folder and returns stdout. Rejects with git's own message when git fails. */
export type RunGit = (args: readonly string[]) => Promise<string>;

/** The variables that tell git which repository to use. An outer hook or worktree session exports them. */
const REPOSITORY_LOCATION_VARIABLES = new Set([
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_PREFIX",
]);

/**
 * `env` without the variables that locate a repository, so git looks at the plugin folder and not at the repository
 * of an outer hook. Everything else stays: `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_CONFIG_*` and the like decide
 * whether `git fetch` and `git ls-remote` can reach the remote at all.
 */
export function repositoryFreeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(env).filter(([name]) => !REPOSITORY_LOCATION_VARIABLES.has(name)));
}

/** Commands that talk to the remote: they must fail with a message instead of waiting for a password on the terminal. */
const REMOTE_COMMANDS = new Set(["fetch", "ls-remote", "push"]);

/** `git ls-remote` only lists refs; a host that does not answer in this time is down or unreachable, not slow. */
export const LS_REMOTE_TIMEOUT_MS = 60_000;

/**
 * The environment of a command that talks to the remote: no password prompt on the terminal, and ssh in batch mode
 * (no passphrase, host key or password question either) unless the user chose their own ssh through `GIT_SSH_COMMAND`,
 * `GIT_SSH` or `core.sshCommand`.
 */
export function remoteEnvironment(env: NodeJS.ProcessEnv, hasOwnSsh: boolean): NodeJS.ProcessEnv {
    const own = hasOwnSsh || (env.GIT_SSH_COMMAND ?? "") !== "" || (env.GIT_SSH ?? "") !== "";
    return { ...env, GIT_TERMINAL_PROMPT: "0", ...(!own && { GIT_SSH_COMMAND: "ssh -o BatchMode=yes" }) };
}

/**
 * The real thing. `baseEnv` is the process environment unless a test passes a hermetic one; the user's git config
 * is respected either way.
 */
export function createRunGit(cwd: string, baseEnv: NodeJS.ProcessEnv = process.env, lsRemoteTimeoutMs = LS_REMOTE_TIMEOUT_MS): RunGit {
    const base = repositoryFreeEnvironment(baseEnv);
    let ownSsh: Promise<boolean> | undefined;
    const hasOwnSsh = (): Promise<boolean> =>
        (ownSsh ??= execFileAsync("git", ["config", "--get", "core.sshCommand"], { cwd, env: base, encoding: "utf8" }).then(
            ({ stdout }) => stdout.trim() !== "",
            () => false,
        ));
    return async (args) => {
        const env = REMOTE_COMMANDS.has(args[0] ?? "") ? remoteEnvironment(base, await hasOwnSsh()) : base;
        try {
            const { stdout } = await execFileAsync("git", [...args], { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...(args[0] === "ls-remote" && { timeout: lsRemoteTimeoutMs }) });
            return stdout;
        } catch (error) {
            throw new Error(describeGitFailure(args, error, lsRemoteTimeoutMs), { cause: error });
        }
    };
}

function describeGitFailure(args: readonly string[], error: unknown, lsRemoteTimeoutMs: number): string {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return "git is not installed or not on PATH.";
    }
    if (args[0] === "ls-remote" && error instanceof Error && "killed" in error && error.killed === true) {
        return `git ${args.join(" ")} did not answer in ${String(lsRemoteTimeoutMs / 1000)} seconds and was stopped.`;
    }
    const stderr = error instanceof Error && "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
    const credentials = /terminal prompts disabled|could not read (?:Username|Password)/i.test(stderr)
        ? "\nGit asked for credentials and opdk never waits for a prompt. Sign in first (a credential helper, `gh auth login` or an SSH key) and rerun."
        : "";
    return `git ${args.join(" ")} failed: ${stderr === "" ? String(error) : stderr}${credentials}`;
}

/** What preflight needs to know about the repository. Gathered by `collectFacts`, judged by `preflightProblems`. */
export interface RepoFacts {
    readonly insideRepo: boolean;
    /** Lines of `git status --porcelain`: changed and untracked files. */
    readonly dirty: readonly string[];
    /** Undefined on a detached HEAD. */
    readonly branch: string | undefined;
    /** From the config, else `origin/HEAD`; undefined when neither gives one. */
    readonly defaultBranch: string | undefined;
    readonly hasOrigin: boolean;
    /** Why `git fetch origin` failed, if it did. */
    readonly fetchError: string | undefined;
    /** Commits on origin's default branch that this branch lacks; undefined when origin has no such branch. */
    readonly behind: number | undefined;
    readonly ahead: number | undefined;
    readonly localTag: boolean;
    readonly remoteTag: "present" | "absent" | "unreachable";
    readonly remoteTagError: string | undefined;
}

export interface FactsInput {
    readonly run: RunGit;
    readonly version: string;
    readonly defaultBranchOverride: string | undefined;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Stdout trimmed, or undefined when git fails: for questions whose answer "no" is a normal outcome. */
export async function tryGit(run: RunGit, args: readonly string[]): Promise<string | undefined> {
    try {
        return (await run(args)).trim();
    } catch {
        return undefined;
    }
}

/** Reads the repository state. `git fetch origin` is the only thing that writes (remote-tracking refs); nothing is pushed. */
export async function collectFacts({ run, version, defaultBranchOverride }: FactsInput): Promise<RepoFacts> {
    if ((await tryGit(run, ["rev-parse", "--is-inside-work-tree"])) !== "true") {
        return { insideRepo: false, dirty: [], branch: undefined, defaultBranch: undefined, hasOrigin: false, fetchError: undefined, behind: undefined, ahead: undefined, localTag: false, remoteTag: "absent", remoteTagError: undefined };
    }
    const dirty = (await run(["status", "--porcelain"])).split("\n").filter((line) => line !== "");
    const branch = await tryGit(run, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const hasOrigin = (await tryGit(run, ["remote", "get-url", "origin"])) !== undefined;
    let fetchError: string | undefined;
    let remoteTag: RepoFacts["remoteTag"] = "absent";
    let remoteTagError: string | undefined;
    if (hasOrigin) {
        try {
            // --no-tags: only the branches are updated, so a tag that exists on origin alone is not copied into the repository.
            await run(["fetch", "--quiet", "--no-tags", "origin"]);
        } catch (error) {
            fetchError = message(error);
        }
        try {
            const listed = await run(["ls-remote", "--tags", "origin", `refs/tags/${version}`]);
            remoteTag = listed.trim() === "" ? "absent" : "present";
        } catch (error) {
            remoteTag = "unreachable";
            remoteTagError = message(error);
        }
    }
    const symbolic = hasOrigin ? await tryGit(run, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]) : undefined;
    const defaultBranch = defaultBranchOverride ?? symbolic?.replace(/^refs\/remotes\/origin\//, "");
    const counts = defaultBranch === undefined ? undefined : await tryGit(run, ["rev-list", "--left-right", "--count", `HEAD...refs/remotes/origin/${defaultBranch}`]);
    const [ahead, behind] = counts?.split(/\s+/).map(Number) ?? [];
    const localTag = (await tryGit(run, ["rev-parse", "--quiet", "--verify", `refs/tags/${version}`])) !== undefined;
    return { insideRepo: true, dirty, branch, defaultBranch, hasOrigin, fetchError, behind, ahead, localTag, remoteTag, remoteTagError };
}

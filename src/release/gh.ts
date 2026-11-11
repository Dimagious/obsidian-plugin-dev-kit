import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repositoryFreeEnvironment } from "./git.js";

const execFileAsync = promisify(execFile);

/** Runs `gh <args>`. `text` returns stdout as text, `bytes` returns it untouched (an asset download). Both reject with gh's own message. */
export interface RunGh {
    text(args: readonly string[]): Promise<string>;
    bytes(args: readonly string[]): Promise<Buffer>;
}

/** Where to get gh; part of the message of every "gh is missing" failure. */
export const GH_INSTALL_HINT = "Install the GitHub CLI from https://cli.github.com and sign in with `gh auth login`.";

/** The real thing. `gh` never prompts: a missing sign-in is an error with a fix, not a question on the terminal. */
export function createRunGh(cwd: string, baseEnv: NodeJS.ProcessEnv = process.env): RunGh {
    const env = { ...repositoryFreeEnvironment(baseEnv), GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", GH_NO_UPDATE_NOTIFIER: "1" };
    const exec = async (args: readonly string[], encoding: "utf8" | "buffer"): Promise<string | Buffer> => {
        try {
            const { stdout } = await execFileAsync("gh", [...args], { cwd, env, encoding, maxBuffer: 256 * 1024 * 1024 });
            return stdout;
        } catch (error) {
            throw new Error(describeGhFailure(args, error), { cause: error });
        }
    };
    return {
        text: async (args) => String(await exec(args, "utf8")),
        bytes: async (args) => {
            const out = await exec(args, "buffer");
            return Buffer.isBuffer(out) ? out : Buffer.from(out);
        },
    };
}

export function describeGhFailure(args: readonly string[], error: unknown): string {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return `gh is not installed or not on PATH. ${GH_INSTALL_HINT}`;
    }
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr).trim() : "";
    return `gh ${args.join(" ")} failed: ${stderr === "" ? String(error) : stderr}`;
}

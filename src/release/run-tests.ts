import { spawn } from "node:child_process";

/**
 * Runs the plugin's `npm test` with its output on the terminal and resolves with the exit code. A command that cannot
 * start (no npm) rejects with the fix, so the release stops instead of tagging untested code.
 */
export function createRunTests(cwd: string, command = "npm"): () => Promise<number> {
    return () =>
        new Promise<number>((resolve, reject) => {
            // `npm` is a .cmd file on Windows, which spawn only starts through a shell.
            const child = spawn(command, ["test"], { cwd, stdio: "inherit", shell: process.platform === "win32" });
            child.once("error", (error) => {
                reject(new Error(`Could not run \`${command} test\`: ${error.message}. Install Node.js with npm, or skip the tests with --no-test.`, { cause: error }));
            });
            child.once("close", (code, signal) => {
                resolve(code ?? (signal === null ? 1 : 128));
            });
        });
}

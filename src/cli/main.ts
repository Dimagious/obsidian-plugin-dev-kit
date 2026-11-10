import { builtinCommands } from "./commands.js";
import { createProcessReporter } from "./process-reporter.js";
import { createRegistry } from "./registry.js";
import { runCli } from "./run.js";
import { readKitVersion } from "./version.js";

/** Binds the CLI to the real process. Called by bin/opdk.js; returns the exit code. */
export function main(argv: readonly string[]): Promise<number> {
    return runCli(argv, {
        registry: createRegistry(builtinCommands),
        version: readKitVersion(import.meta.url),
        ctx: {
            cwd: process.cwd(),
            env: process.env,
            stdout: (text) => process.stdout.write(text),
            stderr: (text) => process.stderr.write(text),
            reporter: createProcessReporter(),
            onInterrupt: (listener) => {
                process.once("SIGINT", listener);
                return () => process.off("SIGINT", listener);
            },
        },
    });
}

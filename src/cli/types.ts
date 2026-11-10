import type { Reporter } from "./reporter.js";

/** What a command gets from the CLI. Everything process-related is injected so commands stay testable. */
export interface CommandContext {
    /** Directory the user ran `opdk` in (the plugin root). */
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    stdout(text: string): void;
    stderr(text: string): void;
    /** How a command prints results and problems; use it instead of writing `stdout`/`stderr` directly. */
    readonly reporter: Reporter;
    /**
     * Registers a Ctrl+C (SIGINT) listener for long-running commands such as `build --vault --watch`
     * and returns a function that removes it. Only registered on demand, so a plain build stays interruptible.
     */
    onInterrupt?(listener: () => void): () => void;
}

/** A subcommand. Each kit module registers one of these. */
export interface Command {
    /** Lowercase letters, digits and dashes, starting with a letter. */
    readonly name: string;
    /** One line shown in `opdk --help`. */
    readonly summary: string;
    /** Full text shown by `opdk <name> --help`. */
    readonly usage: string;
    /** Returns the process exit code. A thrown error is reported by the CLI and exits 1. */
    run(args: readonly string[], ctx: CommandContext): Promise<number>;
}

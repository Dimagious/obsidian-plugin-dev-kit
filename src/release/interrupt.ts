import type { Reporter } from "../cli/reporter.js";

/** The exit code of a process ended by Ctrl+C (128 + SIGINT). */
export const INTERRUPTED_EXIT = 130;

/** What the CLI offers to a command that must clean up when the user presses Ctrl+C. */
export interface InterruptHooks {
    /** Registers a SIGINT listener and returns what removes it (`CommandContext.onInterrupt`). */
    readonly onInterrupt: (listener: () => void) => () => void;
    /** Ends the process. Injected so a test can see the exit code without ending the test run. */
    readonly exit: (code: number) => void;
}

/** Things to undo when the command ends early: restore edited files, remove temp folders. Each runs once. */
export class CleanupSet {
    private readonly actions = new Set<() => void>();

    /** Registers an action and returns what takes it off the list again (the normal path cleans up by itself). */
    add(action: () => void): () => void {
        this.actions.add(action);
        return () => {
            this.actions.delete(action);
        };
    }

    /** Runs every action, even when one throws, then throws the first error so nothing is swallowed. */
    run(): void {
        const errors: unknown[] = [];
        for (const action of [...this.actions]) {
            this.actions.delete(action);
            try {
                action();
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length > 0) {
            throw errors[0];
        }
    }
}

export interface InterruptGuard {
    /** Whether Ctrl+C arrived while the guard was active. */
    interrupted(): boolean;
    /** Unregisters the listener. */
    stop(): void;
}

/**
 * While the guard is active, Ctrl+C runs the cleanups and exits with 130. Registering a SIGINT listener removes
 * Node's default exit, so the listener must end the process itself. Without hooks (a test, a non-CLI caller) it
 * does nothing.
 */
export function guardInterrupt(hooks: InterruptHooks | undefined, cleanups: CleanupSet, reporter: Reporter): InterruptGuard {
    let seen = false;
    let active = true;
    const unregister =
        hooks?.onInterrupt(() => {
            seen = true;
            reporter.warn("release", "interrupted: restoring the files and removing the temp folders");
            try {
                cleanups.run();
            } catch (error) {
                reporter.failure("release", `cleanup after Ctrl+C failed: ${error instanceof Error ? error.message : String(error)}`, {
                    hint: "Look at `git status` and restore the changed files with git; remove opdk-release-* folders from the temp directory.",
                });
            }
            hooks.exit(INTERRUPTED_EXIT);
        }) ?? ((): void => undefined);
    return {
        interrupted: () => seen,
        stop: () => {
            if (active) {
                active = false;
                unregister();
            }
        },
    };
}

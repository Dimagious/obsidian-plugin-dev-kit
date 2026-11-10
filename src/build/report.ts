import { formatMessages, type BuildFailure, type Message } from "esbuild";
import type { CommandContext } from "../cli/types.js";

/** Narrows what esbuild throws when a build has errors. */
export function isBuildFailure(error: unknown): error is BuildFailure {
    return error instanceof Error && "errors" in error && Array.isArray(error.errors);
}

/** Prints esbuild errors or warnings in esbuild's own layout to stderr, coloured when the reporter is. */
export async function printMessages(
    messages: readonly Message[],
    kind: "error" | "warning",
    ctx: Pick<CommandContext, "reporter">,
): Promise<void> {
    if (messages.length === 0) {
        return;
    }
    const formatted = await formatMessages([...messages], { kind, color: ctx.reporter.colorStderr, terminalWidth: 100 });
    ctx.reporter.rawStderr(formatted.join(""));
}

export function formatKib(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} KiB`;
}

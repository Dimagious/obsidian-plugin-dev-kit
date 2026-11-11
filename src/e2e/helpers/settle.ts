/**
 * How long the page must stay free of DOM changes to count as settled. Longer than the 100 ms debounce that
 * Obsidian's views and many plugins use for a refresh, so a refresh that a change schedules still lands inside the
 * wait; short enough that a settled page costs a fraction of a second, which is what the fixed sleeps it replaces
 * were guessing at.
 */
export const DEFAULT_SETTLE_QUIET_MS = 150;

export interface SettleOptions {
    /** Milliseconds without a DOM mutation (inside `root`) that count as quiet. Default 150. Must be below `timeouts.helpers.ui`. */
    quietMs?: number;
    /** CSS selector of the part of the page to watch for changes and images. Default: the whole `<body>` (the demo overlay lives outside it). */
    root?: string;
}

export interface ResolvedSettle {
    readonly quietMs: number;
    /** Null watches the whole body. */
    readonly root: string | null;
}

/** Checks the options of `settle()` against the budget it will wait under. */
export function resolveSettleOptions(options: SettleOptions, budgetMs: number): ResolvedSettle {
    const quietMs = options.quietMs ?? DEFAULT_SETTLE_QUIET_MS;
    if (!Number.isFinite(quietMs) || quietMs < 0) {
        throw new RangeError(`settle(): quietMs must be a number of milliseconds from 0, got ${String(quietMs)}.`);
    }
    if (quietMs >= budgetMs) {
        throw new RangeError(
            `settle(): quietMs (${String(quietMs)} ms) is not below the wait budget timeouts.helpers.ui (${String(budgetMs)} ms), so the page could never be quiet long enough. ` +
                `Lower quietMs, or raise timeouts.helpers.ui.`,
        );
    }
    if (options.root !== undefined && (typeof options.root !== "string" || options.root === "")) {
        throw new TypeError(`settle(): root must be a non-empty CSS selector, got ${JSON.stringify(options.root)}.`);
    }
    return { quietMs, root: options.root ?? null };
}

export function settleRootMissingMessage(root: string): string {
    return `settle(): nothing matches root "${root}", so there is nothing to watch. Check the selector, and that the part of the page it names is on screen.`;
}

/** Why the wait ended without a quiet page. `reasons` come from the page (`unsettledReasons`). */
export function settleTimeoutMessage(params: { budgetMs: number; quietMs: number; root: string | null; reasons: readonly string[] }): string {
    const where = params.root === null ? "the page" : `"${params.root}"`;
    const why = params.reasons.length > 0 ? params.reasons.join("; ") : "it settled just after the budget ran out";
    return (
        `settle(): ${where} was not quiet for ${String(params.quietMs)} ms within ${String(params.budgetMs)} ms (${why}). ` +
        `Raise timeouts.helpers.ui if the app is slow, pass root to watch only the part that matters (something elsewhere keeps changing), ` +
        `or lower quietMs.`
    );
}

import type { Page } from "@playwright/test";
import { isReady, readinessState } from "./page-scripts.js";

/** The button of the plugin trust dialog. The kit never clicks it: both its buttons have side effects (see `waitForReady`). */
export const TRUST_BUTTON_NAME = "Trust author and enable plugins";

export interface ReadinessFailure {
    readonly timeoutMs: number;
    readonly hasApp: boolean;
    readonly layoutReady: boolean;
    /** Plugins Obsidian has not started loading. */
    readonly missing: readonly string[];
    /** Plugins whose `onload()` is still running. */
    readonly loading: readonly string[];
    readonly trustDialogVisible: boolean;
    /** Why a diagnostic could not be collected (for example the window closed). */
    readonly diagnosticsError?: string;
}

/** The message of a failed readiness wait: which plugin did not load, or that the trust dialog is blocking. */
export function formatReadinessFailure(failure: ReadinessFailure): string {
    const head = `Obsidian was not ready after ${String(failure.timeoutMs)} ms.`;
    if (failure.trustDialogVisible) {
        return (
            `${head} The "${TRUST_BUTTON_NAME}" dialog is open: the trust flag the kit sets before the vault loads ` +
            `did not apply, so no plugin was loaded. The kit does not click the dialog (cancelling it disables plugins ` +
            `for good). This points at an Obsidian version that stores the flag differently; report it with the Obsidian version.`
        );
    }
    if (failure.diagnosticsError !== undefined) {
        return `${head} Could not tell why: ${failure.diagnosticsError}`;
    }
    if (!failure.hasApp) {
        return `${head} Obsidian's \`app\` object never appeared, so the vault did not open. Check the seed vault and the Obsidian install.`;
    }
    const parts: string[] = [];
    if (!failure.layoutReady) {
        parts.push("the workspace layout was not ready");
    }
    if (failure.loading.length > 0) {
        parts.push(`plugin${failure.loading.length === 1 ? "" : "s"} still loading: ${failure.loading.join(", ")}`);
    }
    if (failure.missing.length > 0) {
        parts.push(`plugin${failure.missing.length === 1 ? "" : "s"} not loaded: ${failure.missing.join(", ")}`);
    }
    const plugins = failure.loading.length + failure.missing.length > 0;
    return `${head} ${parts.length > 0 ? `${parts.join("; ")}.` : "The state looked ready right after the timeout; raise timeouts.ready."}${
        plugins ? " Check the plugin loads without errors (a slow or hanging onload() shows as still loading; open the developer console in a headed run)." : ""
    }`;
}

/**
 * Waits until the workspace is laid out and, for every plugin id, `app.plugins.plugins[id]` exists and
 * `app.plugins.loadingPluginId` is no longer that id (its `onload()` has finished). The wait is on state, not on
 * sleeps. On a timeout it collects what is still missing or loading and fails with a message that names it.
 */
export async function waitForReady(page: Page, pluginIds: readonly string[], timeoutMs: number): Promise<void> {
    const ids = [...pluginIds];
    try {
        await page.waitForFunction(isReady, ids, { polling: 50, timeout: timeoutMs });
    } catch (error) {
        const failure = await diagnose(page, ids, timeoutMs);
        throw new Error(formatReadinessFailure(failure), { cause: error });
    }
}

async function diagnose(page: Page, ids: string[], timeoutMs: number): Promise<ReadinessFailure> {
    try {
        const state = await page.evaluate(readinessState, ids);
        const trustDialogVisible = await page.getByRole("button", { name: TRUST_BUTTON_NAME }).isVisible();
        return { timeoutMs, ...state, trustDialogVisible };
    } catch (error) {
        return {
            timeoutMs,
            hasApp: false,
            layoutReady: false,
            missing: ids,
            loading: [],
            trustDialogVisible: false,
            diagnosticsError: error instanceof Error ? error.message : String(error),
        };
    }
}

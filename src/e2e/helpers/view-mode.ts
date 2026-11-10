/**
 * How a note is shown: `source` is the plain Markdown editor, `live` is Live Preview and `preview` is reading view.
 * Obsidian stores source and live as the same `mode: "source"` and tells them apart by a `source` flag.
 */
export type ViewMode = "source" | "preview" | "live";

/** The `mode` and `source` fields of a markdown view's state. */
export interface ViewModeState {
    readonly mode: "source" | "preview";
    readonly source: boolean;
}

export function viewModeState(mode: ViewMode): ViewModeState {
    switch (mode) {
        case "preview":
            return { mode: "preview", source: false };
        case "source":
            return { mode: "source", source: true };
        case "live":
            return { mode: "source", source: false };
    }
}

/** True when the view's actual state is the requested mode. Reading view ignores the `source` flag. */
export function viewModeMatches(actual: { mode?: string; source?: boolean } | null, wanted: ViewMode): boolean {
    if (actual === null) {
        return false;
    }
    const target = viewModeState(wanted);
    return actual.mode === target.mode && (target.mode === "preview" || actual.source === target.source);
}

/** The error for a note that stays in the wrong mode after every attempt. */
export function viewModeFailureMessage(path: string, wanted: ViewMode, actual: { mode?: string; source?: boolean } | null, attempts: number): string {
    const seen = actual === null ? "no markdown view is active" : `mode ${String(actual.mode)}, source ${String(actual.source)}`;
    return `${path} did not switch to ${wanted} mode after ${String(attempts)} attempts (${seen}). Is another leaf holding the note in a locked state?`;
}

/** A selector for the active tab's DOM in the wanted mode, to wait for the view to be drawn. */
export function viewModeSelector(mode: ViewMode): string {
    const leaf = ".workspace-leaf.mod-active";
    switch (mode) {
        case "preview":
            return `${leaf} .markdown-reading-view`;
        case "source":
            return `${leaf} .markdown-source-view.mod-cm6:not(.is-live-preview)`;
        case "live":
            return `${leaf} .markdown-source-view.mod-cm6.is-live-preview`;
    }
}

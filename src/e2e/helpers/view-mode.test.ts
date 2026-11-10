import { describe, expect, it } from "vitest";
import { viewModeFailureMessage, viewModeMatches, viewModeSelector, viewModeState } from "./view-mode.js";

describe("viewModeState", () => {
    it("maps the three modes to Obsidian's mode and source flag", () => {
        expect(viewModeState("preview")).toEqual({ mode: "preview", source: false });
        expect(viewModeState("source")).toEqual({ mode: "source", source: true });
        expect(viewModeState("live")).toEqual({ mode: "source", source: false });
    });
});

describe("viewModeMatches", () => {
    it("tells source from live preview by the source flag", () => {
        expect(viewModeMatches({ mode: "source", source: true }, "source")).toBe(true);
        expect(viewModeMatches({ mode: "source", source: false }, "source")).toBe(false);
        expect(viewModeMatches({ mode: "source", source: false }, "live")).toBe(true);
        expect(viewModeMatches({ mode: "source", source: true }, "live")).toBe(false);
    });

    it("ignores the source flag in reading view", () => {
        expect(viewModeMatches({ mode: "preview", source: true }, "preview")).toBe(true);
        expect(viewModeMatches({ mode: "preview", source: false }, "preview")).toBe(true);
        expect(viewModeMatches({ mode: "source", source: false }, "preview")).toBe(false);
    });

    it("is false when there is no view", () => {
        expect(viewModeMatches(null, "source")).toBe(false);
        expect(viewModeMatches({}, "live")).toBe(false);
    });
});

describe("viewModeSelector", () => {
    it("scopes each mode to the active tab", () => {
        expect(viewModeSelector("preview")).toBe(".workspace-leaf.mod-active .markdown-reading-view");
        expect(viewModeSelector("source")).toContain(":not(.is-live-preview)");
        expect(viewModeSelector("live")).toContain(".is-live-preview");
    });
});

describe("viewModeFailureMessage", () => {
    it("says what the view was", () => {
        expect(viewModeFailureMessage("A.md", "preview", { mode: "source", source: true }, 5)).toBe(
            "A.md did not switch to preview mode after 5 attempts (mode source, source true). Is another leaf holding the note in a locked state?",
        );
    });

    it("says when no markdown view is active", () => {
        expect(viewModeFailureMessage("A.md", "live", null, 2)).toContain("no markdown view is active");
    });
});

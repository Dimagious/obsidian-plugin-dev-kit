import type { LayoutFinding } from "./layout-page-scripts.js";

/** Smaller than this, in CSS pixels, is hard to hit with a thumb (Apple's and Material's guidance is 44 and 48). */
export const DEFAULT_MIN_TOUCH_SIZE = 44;
/** Elements the touch check looks at when the spec does not say: what a finger presses. */
export const DEFAULT_TOUCH_TARGETS = 'button, a[href], select, input:not([type="hidden"]), textarea, summary, [role="button"], [role="tab"], [role="menuitem"]';
export const DEFAULT_MAX_FOCUS_STOPS = 20;

export interface TouchTargetOptions {
    /** Smallest width and height, in CSS pixels. Default 44. */
    minSize?: number;
    /** CSS selector of what counts as a target inside `root`. Default: buttons, links, selects, inputs, textareas, summaries and elements with role button, tab or menuitem. */
    selector?: string;
    /** CSS selector of targets to leave out, matched against the target and its ancestors (a checkbox that is drawn small inside a larger row). */
    ignore?: string;
}

export interface OverflowOptions {
    /** CSS selector of elements to leave out, matched against the element and its ancestors (a code block or a table that scrolls on purpose). */
    ignore?: string;
}

export interface FocusRingOptions {
    /** CSS selector of the element where the Tab walk starts. Default: the first element of `root` that can take focus. */
    from?: string;
    /** The walk ends after this many Tab presses if focus has not left `root` by then. Default 20, at most 100. */
    maxStops?: number;
    /** Report it when Tab moves focus out of `root`, as for a modal that must trap focus. Default false: leaving ends the walk without a problem. */
    stayInside?: boolean;
    /** CSS selector of elements the ring check skips (matched against the element and its ancestors), for a control that is replaced on blur or draws its focus state some other way. */
    ignore?: string;
}

/** What `obsidian.checkLayout()` and `obsidian.layoutProblems()` look at. Every check can be turned off. */
export interface LayoutCheckOptions {
    /** CSS selector of the part of the window to check: a modal, a view, a settings tab. Required, so a check never passes by looking at nothing. */
    root: string;
    /** No horizontal overflow inside `root` (`scrollWidth > clientWidth + 1`), scroll panes included. Default true. */
    overflow?: boolean | OverflowOptions;
    /** Touch targets of at least 44 px. Default: on when the window is in the mobile emulation (`obsidian.mobile()`), off otherwise. */
    touchTargets?: boolean | TouchTargetOptions;
    /** Every Tab stop inside `root` shows a focus ring (focus changes an outline or a box-shadow of the element or its ::before/::after). Default false, because it presses Tab and moves focus. */
    focusRing?: boolean | FocusRingOptions;
}

export type LayoutCheckName = "overflow" | "touch-target" | "focus-ring" | "focus-escape";

/** One thing that is wrong, with the check that found it. */
export interface LayoutProblem extends LayoutFinding {
    check: LayoutCheckName;
}

export interface ResolvedLayoutOptions {
    readonly root: string;
    readonly overflow: { enabled: boolean; ignore: string | null };
    /** Null: not given, decided from the window (mobile or not). */
    readonly touch: { enabled: boolean | null; minSize: number; selector: string; ignore: string | null };
    readonly focus: { enabled: boolean; from: string | null; maxStops: number; stayInside: boolean; ignore: string | null };
}

const KNOWN_KEYS = ["root", "overflow", "touchTargets", "focusRing"];
const TOUCH_KEYS = ["minSize", "selector", "ignore"];
const OVERFLOW_KEYS = ["ignore"];
const FOCUS_KEYS = ["from", "maxStops", "stayInside", "ignore"];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        throw new Error(`checkLayout(): unknown key(s) in ${label}: ${unknown.join(", ")}. Allowed keys: ${allowed.join(", ")}.`);
    }
}

function optionalSelector(value: unknown, label: string): string | null {
    if (value === undefined) {
        return null;
    }
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`checkLayout(): ${label} must be a non-empty CSS selector, got ${JSON.stringify(value)}.`);
    }
    return value;
}

/** Checks the options a spec passed (it may be plain JavaScript or a cast) and fills in the defaults. */
export function resolveLayoutOptions(options: unknown): ResolvedLayoutOptions {
    if (!isRecord(options)) {
        throw new Error('checkLayout(): pass an object with the root to check, for example checkLayout({ root: ".modal" }).');
    }
    rejectUnknown(options, KNOWN_KEYS, "the options");
    const root = optionalSelector(options.root, "root");
    if (root === null) {
        throw new Error('checkLayout(): root is required, the CSS selector of the part of the window to check, for example checkLayout({ root: ".modal" }).');
    }
    const { overflow, touchTargets, focusRing } = options;
    const touch = resolveTouch(touchTargets);
    const focus = resolveFocus(focusRing);
    return { root, overflow: resolveOverflow(overflow), touch, focus };
}

function resolveOverflow(value: unknown): ResolvedLayoutOptions["overflow"] {
    if (value === undefined || typeof value === "boolean") {
        return { enabled: value ?? true, ignore: null };
    }
    if (!isRecord(value)) {
        throw new Error(`checkLayout(): overflow must be true, false or an object { ignore? }, got ${JSON.stringify(value)}.`);
    }
    rejectUnknown(value, OVERFLOW_KEYS, "overflow");
    return { enabled: true, ignore: optionalSelector(value.ignore, "overflow.ignore") };
}

function resolveTouch(value: unknown): ResolvedLayoutOptions["touch"] {
    const defaults = { minSize: DEFAULT_MIN_TOUCH_SIZE, selector: DEFAULT_TOUCH_TARGETS, ignore: null };
    if (value === undefined) {
        return { enabled: null, ...defaults };
    }
    if (typeof value === "boolean") {
        return { enabled: value, ...defaults };
    }
    if (!isRecord(value)) {
        throw new Error(`checkLayout(): touchTargets must be true, false or an object { minSize?, selector?, ignore? }, got ${JSON.stringify(value)}.`);
    }
    rejectUnknown(value, TOUCH_KEYS, "touchTargets");
    const { minSize } = value;
    if (minSize !== undefined && (typeof minSize !== "number" || !Number.isFinite(minSize) || minSize <= 0)) {
        throw new Error(`checkLayout(): touchTargets.minSize must be a number of CSS pixels above 0, got ${JSON.stringify(minSize)}.`);
    }
    return {
        enabled: true,
        minSize: minSize ?? DEFAULT_MIN_TOUCH_SIZE,
        selector: optionalSelector(value.selector, "touchTargets.selector") ?? DEFAULT_TOUCH_TARGETS,
        ignore: optionalSelector(value.ignore, "touchTargets.ignore"),
    };
}

function resolveFocus(value: unknown): ResolvedLayoutOptions["focus"] {
    if (value === undefined || typeof value === "boolean") {
        return { enabled: value ?? false, from: null, maxStops: DEFAULT_MAX_FOCUS_STOPS, stayInside: false, ignore: null };
    }
    if (!isRecord(value)) {
        throw new Error(`checkLayout(): focusRing must be true, false or an object { from?, maxStops?, stayInside?, ignore? }, got ${JSON.stringify(value)}.`);
    }
    rejectUnknown(value, FOCUS_KEYS, "focusRing");
    const { maxStops } = value;
    if (maxStops !== undefined && (typeof maxStops !== "number" || !Number.isInteger(maxStops) || maxStops < 1 || maxStops > 100)) {
        throw new Error(`checkLayout(): focusRing.maxStops must be a whole number from 1 to 100, got ${JSON.stringify(maxStops)}.`);
    }
    const { stayInside } = value;
    if (stayInside !== undefined && typeof stayInside !== "boolean") {
        throw new Error(`checkLayout(): focusRing.stayInside must be true or false, got ${JSON.stringify(stayInside)}.`);
    }
    return { enabled: true, from: optionalSelector(value.from, "focusRing.from"), maxStops: maxStops ?? DEFAULT_MAX_FOCUS_STOPS, stayInside: stayInside ?? false, ignore: optionalSelector(value.ignore, "focusRing.ignore") };
}

export function rootMissingMessage(root: string): string {
    return `checkLayout(): nothing matches the root ${JSON.stringify(root)}. Open the part of the window you want to check before the call, and check the selector.`;
}

export function noChecksMessage(): string {
    return "checkLayout(): nothing to check. Every check is off (touch targets are only on by default in the mobile emulation). Turn one on: overflow, touchTargets or focusRing.";
}

/** Why a Tab walk could not start, as a sentence that says what to do. */
export function focusStartMessage(outcome: "no-start" | "outside-root" | "not-focused", root: string, from: string | null): string {
    if (outcome === "outside-root") {
        return `checkLayout(): focusRing.from ${JSON.stringify(from)} is not inside ${JSON.stringify(root)}, so the walk would check nothing of it. Pick an element inside the root.`;
    }
    if (outcome === "not-focused") {
        return `checkLayout(): the element where the Tab walk starts${from === null ? "" : ` (${JSON.stringify(from)})`} did not take focus. Pick a focusable element inside ${JSON.stringify(root)} (a button, a link, an input, or tabindex="0").`;
    }
    return from === null
        ? `checkLayout(): nothing inside ${JSON.stringify(root)} can take focus (no visible, enabled button, link, input, select or tabindex="0"), so there are no Tab stops to check. Turn focusRing off, or check the selector.`
        : `checkLayout(): focusRing.from ${JSON.stringify(from)} matches nothing. Check the selector.`;
}

/** Cut a problem list to `limit` per kind. The totals of the kinds that were cut go back, so the failure can say "first 10 of N". */
export function capProblems(problems: readonly LayoutProblem[], limit: number): { problems: LayoutProblem[]; cuts: LayoutCut[] } {
    const kept: LayoutProblem[] = [];
    const totals = new Map<LayoutCheckName, number>();
    for (const problem of problems) {
        const total = (totals.get(problem.check) ?? 0) + 1;
        totals.set(problem.check, total);
        if (total <= limit) {
            kept.push(problem);
        }
    }
    return { problems: kept, cuts: [...totals].filter(([, total]) => total > limit).map(([check, total]) => ({ check, total })) };
}

/** A kind of problem that has more findings than the list shows. */
export interface LayoutCut {
    check: LayoutCheckName;
    total: number;
}

const LABELS: Record<LayoutCheckName, string> = {
    overflow: "horizontal overflow",
    "touch-target": "touch target too small",
    "focus-ring": "no focus ring",
    "focus-escape": "focus left the root",
};

/** The failure text: one line per problem, so a run lists everything that is wrong at once. */
export function layoutFailureMessage(root: string, problems: readonly LayoutProblem[], minSize: number, cuts: readonly LayoutCut[] = []): string {
    const lines = problems.map((problem) => `  - ${LABELS[problem.check]}: ${problem.where} (${problem.detail})`);
    for (const cut of cuts) {
        lines.push(`  - ${LABELS[cut.check]}: (first ${String(problems.filter((problem) => problem.check === cut.check).length)} of ${String(cut.total)})`);
    }
    const hints: string[] = [];
    if (problems.some((problem) => problem.check === "touch-target")) {
        hints.push(`Touch targets must be at least ${String(minSize)} px; raise the size in CSS for the mobile layout, or pass touchTargets: { ignore } for an element that is not a target.`);
    }
    if (problems.some((problem) => problem.check === "focus-ring")) {
        hints.push("A focus ring is an outline or a box-shadow that focus changes, on the element or its ::before/::after (a resting box-shadow does not count); a theme that sets outline: none needs a replacement.");
    }
    if (problems.some((problem) => problem.check === "focus-escape")) {
        hints.push("Keep Tab inside a modal: focus the first control again when Tab leaves the last one.");
    }
    return [`checkLayout(): ${String(problems.length)} ${problems.length === 1 ? "problem" : "problems"} inside ${JSON.stringify(root)}:`, ...lines, ...hints].join("\n");
}

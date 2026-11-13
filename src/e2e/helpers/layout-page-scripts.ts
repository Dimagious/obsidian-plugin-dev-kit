/**
 * Page functions of the layout checks (`obsidian.checkLayout()`). Like `page-scripts.ts` each one is serialised, so it
 * is self-contained: only its own source text crosses into the page. They are exported so tests can run them against a
 * fake `document`. The kit's TypeScript has no DOM types, hence the small interfaces below. The code that names an
 * element (`describe`, `where`) is written out in each function for the same reason: no function can call another.
 */

interface LayoutRect {
    width: number;
    height: number;
}

interface LayoutElement {
    tagName: string;
    id: string;
    className: unknown;
    scrollWidth: number;
    clientWidth: number;
    clientHeight: number;
    disabled?: boolean;
    getClientRects(): ArrayLike<unknown>;
    getBoundingClientRect(): LayoutRect;
    querySelectorAll(selector: string): ArrayLike<LayoutElement>;
    closest(selector: string): unknown;
    contains(other: unknown): boolean;
    focus(): void;
    blur(): void;
}

interface LayoutStyle {
    overflowX: string;
    overflowY: string;
    textOverflow: string;
    whiteSpace: string;
    clipPath: string;
    clip: string;
    visibility: string;
    outlineStyle: string;
    outlineWidth: string;
    outlineColor: string;
    outlineOffset: string;
    boxShadow: string;
}

interface LayoutStyleSheet {
    textContent: string | null;
    remove(): void;
}

interface LayoutGlobals {
    document?: {
        querySelector(selector: string): LayoutElement | null;
        activeElement: LayoutElement | null;
        createElement(tag: string): LayoutStyleSheet;
        documentElement: { append(node: unknown): void };
    };
    getComputedStyle?(element: LayoutElement): LayoutStyle;
    /** The elements a focus walk has visited, to notice a trap. Replaced by `focusWalkStart`. */
    __opdkFocusSeen?: WeakSet<object>;
}

/** One thing a layout check found; `where` names the element the way a person finds it (`button.save-button`). */
export interface LayoutFinding {
    where: string;
    /** What is wrong, with the measured numbers. */
    detail: string;
}

/** The result of a page function that needs the root: it may not exist. `total` counts every finding, `findings` holds the first `limit`. */
export type LayoutResult = { rootFound: false } | { rootFound: true; findings: LayoutFinding[]; total: number };

/** At most this many findings of one kind are reported; a broken layout would otherwise list the whole tree. */
export const MAX_FINDINGS_PER_CHECK = 10;

/** Whether anything matches `selector`. Asked once before any check runs, so a missing root fails even when every check is off. */
export function rootExists(selector: string): boolean {
    const globals = globalThis as unknown as LayoutGlobals;
    return (globals.document?.querySelector(selector) ?? null) !== null;
}

/**
 * Elements inside `root` (and `root` itself) that are wider than their box: `scrollWidth > clientWidth + 1`, the
 * same test as for a horizontal scroll bar. Every element is checked, scroll panes included: `overflow-y: auto`
 * makes the computed `overflow-x` auto too, so the computed style cannot tell a pane that scrolls on purpose from
 * one whose content spills sideways. Skipped, because they are not layout bugs:
 * - an element that cuts its text with an ellipsis (`text-overflow: ellipsis`, or `white-space: nowrap` with
 *   `overflow: hidden`), which Obsidian does for setting names and tabs;
 * - a visually hidden box (1 px or less, clipped by `overflow`, `clip` or `clip-path`), the "screen reader only" pattern;
 * - an element inside `ignore` (a selector matched against the element and its ancestors).
 */
export function findOverflow(args: { root: string; ignore: string | null; limit: number }): LayoutResult {
    const globals = globalThis as unknown as LayoutGlobals;
    const root = globals.document?.querySelector(args.root) ?? null;
    if (root === null) {
        return { rootFound: false };
    }
    const describe = (element: LayoutElement): string => {
        const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter((name) => name !== "") : [];
        return element.tagName.toLowerCase() + (element.id === "" ? "" : `#${element.id}`) + classes.map((name) => `.${name}`).join("");
    };
    const findings: LayoutFinding[] = [];
    let total = 0;
    for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (element.scrollWidth <= element.clientWidth + 1) {
            continue;
        }
        if (args.ignore !== null && element.closest(args.ignore) !== null) {
            continue;
        }
        const style = globals.getComputedStyle?.(element);
        if (style !== undefined) {
            const clips = (value: string): boolean => value === "hidden" || value === "clip";
            const ellipsis = style.textOverflow === "ellipsis" || (style.whiteSpace === "nowrap" && clips(style.overflowX));
            const tiny = element.clientWidth <= 1 || element.clientHeight <= 1;
            const cut = clips(style.overflowX) || clips(style.overflowY) || (style.clipPath !== "none" && style.clipPath !== "") || (style.clip !== "auto" && style.clip !== "");
            if (ellipsis || (tiny && cut)) {
                continue;
            }
        }
        total += 1;
        if (findings.length < args.limit) {
            findings.push({ where: describe(element), detail: `scrollWidth ${String(element.scrollWidth)} > clientWidth ${String(element.clientWidth)}` });
        }
    }
    return { rootFound: true, findings, total };
}

/**
 * Visible elements inside `root` that match `targetSelector` (and not `ignoreSelector`) and are smaller than `minSize`
 * CSS pixels in either direction, less 0.5 px for rounding. Visible means it has a box (`getClientRects()`, which
 * `position: fixed` elements have too, unlike `offsetParent`) and is not `visibility: hidden`.
 */
export function findSmallTargets(args: { root: string; targets: string; ignore: string | null; minSize: number; limit: number }): LayoutResult {
    const globals = globalThis as unknown as LayoutGlobals;
    const root = globals.document?.querySelector(args.root) ?? null;
    if (root === null) {
        return { rootFound: false };
    }
    const describe = (element: LayoutElement): string => {
        const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter((name) => name !== "") : [];
        return element.tagName.toLowerCase() + (element.id === "" ? "" : `#${element.id}`) + classes.map((name) => `.${name}`).join("");
    };
    const findings: LayoutFinding[] = [];
    let total = 0;
    for (const element of Array.from(root.querySelectorAll(args.targets))) {
        // A hidden element has no box; it cannot be tapped, so its size does not matter.
        if (element.getClientRects().length === 0 || globals.getComputedStyle?.(element).visibility === "hidden" || (args.ignore !== null && element.closest(args.ignore) !== null)) {
            continue;
        }
        const box = element.getBoundingClientRect();
        if (box.width < args.minSize - 0.5 || box.height < args.minSize - 0.5) {
            total += 1;
            if (findings.length < args.limit) {
                findings.push({ where: describe(element), detail: `${String(Math.round(box.width))} x ${String(Math.round(box.height))} px` });
            }
        }
    }
    return { rootFound: true, findings, total };
}

/**
 * Moves focus to the element that starts a Tab walk and forgets the elements of the last walk. The start is `from`, or
 * else the first element of `root` that can take focus, is shown (has a box, not `visibility: hidden`) and is not
 * disabled. The walk would check nothing if the start sat outside `root` or did not take focus, so both are named.
 */
export function focusWalkStart(args: { root: string; from: string | null }): "ok" | "no-root" | "no-start" | "outside-root" | "not-focused" {
    const globals = globalThis as unknown as LayoutGlobals;
    const root = globals.document?.querySelector(args.root) ?? null;
    if (root === null) {
        return "no-root";
    }
    const shown = (element: LayoutElement): boolean => element.getClientRects().length > 0 && globals.getComputedStyle?.(element).visibility !== "hidden";
    const focusable = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
    const start = args.from === null ? (Array.from(root.querySelectorAll(focusable)).find((element) => shown(element) && element.disabled !== true) ?? null) : (globals.document?.querySelector(args.from) ?? null);
    if (start === null) {
        return "no-start";
    }
    if (!root.contains(start)) {
        return "outside-root";
    }
    start.focus();
    if (globals.document?.activeElement !== start) {
        return "not-focused";
    }
    globals.__opdkFocusSeen = new WeakSet();
    return "ok";
}

/** What the element that has focus looks like: where it is, and whether focus changes anything about it. */
export interface FocusStop {
    /** False when focus left `root`: the walk is over. */
    inRoot: boolean;
    /** The element was already visited by this walk: focus went round in a circle (a focus trap). */
    repeat: boolean;
    where: string;
    hasRing: boolean;
    detail: string;
}

/**
 * Reads the element that has focus. It counts as showing a focus ring only when its outline or its box-shadow
 * differs from the same element without focus: Obsidian gives every button a resting `box-shadow`, so "has a
 * shadow" would pass a button whose ring was removed. The element is blurred for the second read and focused again.
 * Transitions are switched off for both reads, because a style that has just changed would read as the old value.
 */
export function readFocusStop(rootSelector: string): FocusStop | null {
    const globals = globalThis as unknown as LayoutGlobals;
    const root = globals.document?.querySelector(rootSelector) ?? null;
    const element = globals.document?.activeElement ?? null;
    if (root === null || element === null || globals.document === undefined || globals.getComputedStyle === undefined) {
        return null;
    }
    const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter((name) => name !== "") : [];
    const where = element.tagName.toLowerCase() + (element.id === "" ? "" : `#${element.id}`) + classes.map((name) => `.${name}`).join("");
    const seen = (globals.__opdkFocusSeen ??= new WeakSet());
    const repeat = seen.has(element);
    seen.add(element);
    const inRoot = root.contains(element);
    if (!inRoot) {
        return { inRoot, repeat, where, hasRing: true, detail: "outside the root" };
    }
    const quiet = globals.document.createElement("style");
    quiet.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
    globals.document.documentElement.append(quiet);
    const read = (): { outline: string; outlineVisible: boolean; shadow: string } => {
        const style = globals.getComputedStyle?.(element);
        const shadow = style === undefined || style.boxShadow === "" ? "none" : style.boxShadow;
        return {
            outline: style === undefined ? "" : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} offset ${style.outlineOffset}`,
            outlineVisible: style !== undefined && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
            shadow,
        };
    };
    try {
        const focused = read();
        element.blur();
        const plain = read();
        element.focus();
        const outlineRing = focused.outlineVisible && focused.outline !== plain.outline;
        const shadowRing = focused.shadow !== "none" && focused.shadow !== plain.shadow;
        return {
            inRoot,
            repeat,
            where,
            hasRing: outlineRing || shadowRing,
            detail: `focus changes neither the outline (${focused.outline.replace(/ offset .*$/, "")}) nor the box-shadow (${focused.shadow})`,
        };
    } finally {
        quiet.remove();
    }
}

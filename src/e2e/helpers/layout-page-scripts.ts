/**
 * Page functions of the layout checks (`obsidian.checkLayout()`). Like `page-scripts.ts` each one is serialised, so it
 * is self-contained: only its own source text crosses into the page. They are exported so tests can run them against a
 * fake `document`. The kit's TypeScript has no DOM types, hence the small interfaces below. The code that names an
 * element (`describe`, `where`) is written out in each function for the same reason: no function can call another.
 */

interface LayoutRect {
    x: number;
    y: number;
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
    type?: string;
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
    getComputedStyle?(element: LayoutElement, pseudo?: string): LayoutStyle;
    /** The elements a focus walk has visited, to notice a trap. Replaced by `focusWalkStart`. */
    __opdkFocusSeen?: WeakSet<object>;
    /** The element and the style sheet of a pixel comparison between `begin` and `end` (see `pixelStep`). */
    __opdkPixel?: { element: LayoutElement; quiet: LayoutStyleSheet };
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
    /**
     * Set when `hasRing` is false for an element whose ring Obsidian draws on a vendor pseudo-element that
     * `getComputedStyle` cannot read (the thumb of a range input, the swatch of a colour input): the box to compare as
     * pixels, focused against blurred, with `pixelStep`. Null for every other element.
     */
    pixelBox: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Reads the element that has focus. It counts as showing a focus ring only when an outline or a box-shadow differs
 * from the same element without focus: Obsidian gives every button a resting `box-shadow`, so "has a shadow" would
 * pass a button whose ring was removed. Obsidian also draws some rings on a pseudo-element (a `.setting-item` rings
 * itself with `:focus-visible::after`), so the element, its `::before` and its `::after` are all compared; a change
 * in any of them is a ring. Vendor pseudo-elements (`::-webkit-slider-thumb`, `::-webkit-color-swatch`) are not
 * readable: `getComputedStyle` answers with the style of the element itself. A range or colour input without a ring
 * in the readable parts is returned with a `pixelBox`, and the walk compares pixels for it. The
 * element is blurred for the second read and focused again; if it did not take focus back (it was replaced or
 * detached on blur) the walk cannot go on and this throws. Transitions are switched off for both reads, because a
 * style that has just changed would read as the old value. An element inside `ignore` passes without a read.
 */
export function readFocusStop(args: { root: string; ignore: string | null }): FocusStop | null {
    const globals = globalThis as unknown as LayoutGlobals;
    const root = globals.document?.querySelector(args.root) ?? null;
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
        return { inRoot, repeat, where, hasRing: true, detail: "outside the root", pixelBox: null };
    }
    if (args.ignore !== null && element.closest(args.ignore) !== null) {
        return { inRoot, repeat, where, hasRing: true, detail: "ignored", pixelBox: null };
    }
    const quiet = globals.document.createElement("style");
    quiet.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
    globals.document.documentElement.append(quiet);
    const parts = ["", "::before", "::after"];
    const vendorRing = element.tagName.toLowerCase() === "input" && (element.type === "range" || element.type === "color");
    const read = (): { outline: string; outlineVisible: boolean; shadow: string }[] =>
        parts.map((part) => {
            const style = globals.getComputedStyle?.(element, part === "" ? undefined : part);
            return {
                outline: style === undefined ? "" : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} offset ${style.outlineOffset}`,
                outlineVisible: style !== undefined && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
                shadow: style === undefined || style.boxShadow === "" ? "none" : style.boxShadow,
            };
        });
    try {
        const focused = read();
        element.blur();
        const plain = read();
        element.focus();
        if (globals.document.activeElement !== element) {
            throw new Error(`${where} did not take focus back after the focus ring check blurred it: it was replaced or detached on blur, so the Tab walk cannot go on. Add it to focusRing.ignore, or keep the element in place on blur.`);
        }
        const ring = focused.some((now, index) => {
            const before = plain[index];
            return before !== undefined && ((now.outlineVisible && now.outline !== before.outline) || (now.shadow !== "none" && now.shadow !== before.shadow));
        });
        const own = focused[0];
        const box = element.getBoundingClientRect();
        return {
            inRoot,
            repeat,
            where,
            hasRing: ring,
            pixelBox: !ring && vendorRing ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
            detail: `focus changes neither the outline (${(own?.outline ?? "").replace(/ offset .*$/, "")}) nor the box-shadow (${own?.shadow ?? "none"}), on the element or its ${parts.slice(1).join(", ")}`,
        };
    } finally {
        quiet.remove();
    }
}

/**
 * The page side of the pixel comparison for an element whose ring cannot be read (see `FocusStop.pixelBox`). `begin`
 * switches transitions off, `blur` takes focus away, anything else (`end`) gives it back and removes the style. The caller takes a
 * screenshot between the steps. It is false when `end` finds the element did not take focus back.
 */
export function pixelStep(step: string): boolean {
    const globals = globalThis as unknown as LayoutGlobals;
    const doc = globals.document;
    if (doc === undefined) {
        return false;
    }
    if (step === "begin") {
        const element = doc.activeElement;
        if (element === null) {
            return false;
        }
        const quiet = doc.createElement("style");
        quiet.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
        doc.documentElement.append(quiet);
        globals.__opdkPixel = { element, quiet };
        return true;
    }
    const state = globals.__opdkPixel;
    if (state === undefined) {
        return false;
    }
    if (step === "blur") {
        state.element.blur();
        return true;
    }
    state.element.focus();
    state.quiet.remove();
    Reflect.deleteProperty(globals, "__opdkPixel");
    return doc.activeElement === state.element;
}

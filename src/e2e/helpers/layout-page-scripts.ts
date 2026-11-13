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
    offsetParent: unknown;
    getBoundingClientRect(): LayoutRect;
    querySelectorAll(selector: string): ArrayLike<LayoutElement>;
    closest(selector: string): unknown;
    contains(other: unknown): boolean;
    focus(): void;
}

interface LayoutStyle {
    overflowX: string;
    outlineStyle: string;
    outlineWidth: string;
    boxShadow: string;
}

interface LayoutGlobals {
    document?: {
        querySelector(selector: string): LayoutElement | null;
        activeElement: LayoutElement | null;
    };
    getComputedStyle?(element: LayoutElement): LayoutStyle;
}

/** One thing a layout check found; `where` names the element the way a person finds it (`button.save-button`). */
export interface LayoutFinding {
    where: string;
    /** What is wrong, with the measured numbers. */
    detail: string;
}

/** The result of a page function that needs the root: it may not exist. */
export type LayoutResult = { rootFound: false } | { rootFound: true; findings: LayoutFinding[] };

/** At most this many findings of one kind are collected; a broken layout would otherwise list the whole tree. */
export const MAX_FINDINGS_PER_CHECK = 10;

/**
 * Elements inside `root` (and `root` itself) that are wider than their box: `scrollWidth > clientWidth + 1`, the
 * same test as for a horizontal scroll bar. An element that scrolls on purpose (`overflow-x: auto` or `scroll`: a
 * code block, a table) is skipped, except `root`, whose sideways scroll is what the check is for.
 */
export function findOverflow(args: { root: string; limit: number }): LayoutResult {
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
    const candidates = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const element of candidates) {
        if (findings.length >= args.limit) {
            break;
        }
        if (element.scrollWidth <= element.clientWidth + 1) {
            continue;
        }
        const scrollsOnPurpose = element !== root && /^(auto|scroll)$/.test(globals.getComputedStyle?.(element).overflowX ?? "");
        if (!scrollsOnPurpose) {
            findings.push({ where: describe(element), detail: `scrollWidth ${String(element.scrollWidth)} > clientWidth ${String(element.clientWidth)}` });
        }
    }
    return { rootFound: true, findings };
}

/**
 * Visible elements inside `root` that match `targetSelector` (and not `ignoreSelector`) and are smaller than `minSize`
 * CSS pixels in either direction, less 0.5 px for rounding.
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
    for (const element of Array.from(root.querySelectorAll(args.targets))) {
        if (findings.length >= args.limit) {
            break;
        }
        // A hidden element has no offset parent; it cannot be tapped, so its size does not matter.
        if (element.offsetParent === null || (args.ignore !== null && element.closest(args.ignore) !== null)) {
            continue;
        }
        const box = element.getBoundingClientRect();
        if (box.width < args.minSize - 0.5 || box.height < args.minSize - 0.5) {
            findings.push({ where: describe(element), detail: `${String(Math.round(box.width))} x ${String(Math.round(box.height))} px` });
        }
    }
    return { rootFound: true, findings };
}

/** Moves focus to the element that starts a Tab walk: `from` when given, else the first element of `root` that can take focus. */
export function focusWalkStart(args: { root: string; from: string | null }): "ok" | "no-root" | "no-start" {
    const globals = globalThis as unknown as LayoutGlobals;
    const root = globals.document?.querySelector(args.root) ?? null;
    if (root === null) {
        return "no-root";
    }
    const start = args.from === null ? Array.from(root.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'))[0] ?? null : (globals.document?.querySelector(args.from) ?? null);
    if (start === null) {
        return "no-start";
    }
    start.focus();
    return "ok";
}

/** What the element that has focus looks like: where it is, and whether anything marks it as focused. */
export interface FocusStop {
    /** False when focus left `root`: the walk is over. */
    inRoot: boolean;
    where: string;
    hasRing: boolean;
    detail: string;
}

export function readFocusStop(rootSelector: string): FocusStop | null {
    const globals = globalThis as unknown as LayoutGlobals;
    const root = globals.document?.querySelector(rootSelector) ?? null;
    const element = globals.document?.activeElement ?? null;
    if (root === null || element === null) {
        return null;
    }
    const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter((name) => name !== "") : [];
    const where = element.tagName.toLowerCase() + (element.id === "" ? "" : `#${element.id}`) + classes.map((name) => `.${name}`).join("");
    const style = globals.getComputedStyle?.(element);
    const outline = style !== undefined && style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    const shadow = style !== undefined && style.boxShadow !== "none" && style.boxShadow !== "";
    return {
        inRoot: root.contains(element),
        where,
        hasRing: outline || shadow,
        detail: style === undefined ? "its style cannot be read" : `outline ${style.outlineStyle} ${style.outlineWidth}, box-shadow ${style.boxShadow === "" ? "none" : style.boxShadow}`,
    };
}

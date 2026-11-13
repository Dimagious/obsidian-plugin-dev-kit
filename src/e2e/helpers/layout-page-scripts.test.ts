import { afterEach, describe, expect, it, vi } from "vitest";
import { findOverflow, findSmallTargets, focusWalkStart, readFocusStop, rootExists } from "./layout-page-scripts.js";

interface FakeStyle {
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

interface FakeElement extends FakeStyle {
    tagName: string;
    id: string;
    className: unknown;
    scrollWidth: number;
    clientWidth: number;
    clientHeight: number;
    disabled?: boolean;
    rects: unknown[];
    rect: { width: number; height: number };
    children: FakeElement[];
    closestMatches: string[];
    /** Style changes that apply while the element has focus. */
    focused: Partial<FakeStyle>;
    focus: () => void;
    blur: () => void;
    getClientRects: () => unknown[];
    getBoundingClientRect: () => { width: number; height: number };
    querySelectorAll: (selector: string) => FakeElement[];
    closest: (selector: string) => unknown;
    contains: (other: unknown) => boolean;
}

/** The element that has focus in the fake document, and how many injected style sheets are still on the page. */
const page: { active: FakeElement | null; styleSheets: number } = { active: null, styleSheets: 0 };

function el(tagName: string, className: unknown = "", extra: Partial<FakeElement> = {}): FakeElement {
    const element: FakeElement = {
        tagName: tagName.toUpperCase(),
        id: "",
        className,
        scrollWidth: 100,
        clientWidth: 100,
        clientHeight: 20,
        rects: [{}],
        overflowX: "visible",
        overflowY: "visible",
        textOverflow: "clip",
        whiteSpace: "normal",
        clipPath: "none",
        clip: "auto",
        visibility: "visible",
        outlineStyle: "none",
        outlineWidth: "0px",
        outlineColor: "rgb(0, 0, 0)",
        outlineOffset: "0px",
        boxShadow: "none",
        rect: { width: 100, height: 100 },
        children: [],
        closestMatches: [],
        focused: {},
        focus: () => {
            page.active = element;
        },
        blur: () => {
            page.active = null;
        },
        getClientRects: () => element.rects,
        getBoundingClientRect: () => element.rect,
        querySelectorAll: () => element.children,
        closest: (selector) => (element.closestMatches.includes(selector) ? {} : null),
        contains: (other) => other === element || element.children.includes(other as FakeElement),
        ...extra,
    };
    return element;
}

/** `selectors` maps what `document.querySelector` is asked to the element it returns. */
function stubDocument(selectors: Record<string, FakeElement>, active: FakeElement | null = null): void {
    page.active = active;
    page.styleSheets = 0;
    vi.stubGlobal("document", {
        querySelector: (selector: string) => selectors[selector] ?? null,
        get activeElement() {
            return page.active;
        },
        createElement: () => ({
            textContent: "",
            remove: () => {
                page.styleSheets -= 1;
            },
        }),
        documentElement: {
            append: () => {
                page.styleSheets += 1;
            },
        },
    });
    vi.stubGlobal("getComputedStyle", (element: FakeElement): FakeStyle => ({ ...element, ...(page.active === element ? element.focused : {}) }));
}

afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "__opdkFocusSeen");
});

const overflowArgs = { root: ".wizard", ignore: null as string | null, limit: 10 };

describe("rootExists", () => {
    it("says whether the selector matches", () => {
        stubDocument({ ".m": el("div") });
        expect(rootExists(".m")).toBe(true);
        expect(rootExists(".nope")).toBe(false);
    });
});

describe("findOverflow", () => {
    it("reports a missing root", () => {
        stubDocument({});
        expect(findOverflow({ ...overflowArgs, root: ".nope" })).toEqual({ rootFound: false });
    });

    it("finds nothing when everything fits, with one pixel of rounding allowed", () => {
        const child = el("div", "row", { scrollWidth: 101, clientWidth: 100 });
        stubDocument({ ".wizard": el("div", "wizard", { children: [child] }) });
        expect(findOverflow(overflowArgs)).toEqual({ rootFound: true, findings: [], total: 0 });
    });

    it("names the root and the descendants that are wider than their box", () => {
        const wide = el("div", "row  big", { id: "r1", scrollWidth: 300, clientWidth: 200 });
        const root = el("div", "wizard", { scrollWidth: 420, clientWidth: 390, children: [wide, el("p")] });
        stubDocument({ ".wizard": root });
        expect(findOverflow(overflowArgs)).toEqual({
            rootFound: true,
            findings: [
                { where: "div.wizard", detail: "scrollWidth 420 > clientWidth 390" },
                { where: "div#r1.row.big", detail: "scrollWidth 300 > clientWidth 200" },
            ],
            total: 2,
        });
    });

    it("checks a scroll pane too: overflow-y auto makes overflow-x auto, and its content can still spill sideways", () => {
        const pane = el("div", "pane", { scrollWidth: 900, clientWidth: 200, overflowX: "auto", overflowY: "auto" });
        const table = el("div", "table", { scrollWidth: 900, clientWidth: 200, overflowX: "scroll" });
        stubDocument({ ".wizard": el("div", "wizard", { children: [pane, table] }) });
        const result = findOverflow(overflowArgs);
        expect(result.rootFound && result.findings.map((finding) => finding.where)).toEqual(["div.pane", "div.table"]);
    });

    it("leaves out what the caller ignores, matched through ancestors", () => {
        const code = el("pre", "code", { scrollWidth: 900, clientWidth: 200, closestMatches: ["pre"] });
        const other = el("div", "row", { scrollWidth: 900, clientWidth: 200 });
        stubDocument({ ".wizard": el("div", "wizard", { children: [code, other] }) });
        const result = findOverflow({ ...overflowArgs, ignore: "pre" });
        expect(result.rootFound && result.findings.map((finding) => finding.where)).toEqual(["div.row"]);
    });

    it("skips a text that is cut with an ellipsis, or nowrap with overflow hidden, but not nowrap alone", () => {
        const ellipsis = el("div", "setting-item-name", { scrollWidth: 400, clientWidth: 100, textOverflow: "ellipsis" });
        const nowrap = el("div", "tab", { scrollWidth: 400, clientWidth: 100, whiteSpace: "nowrap", overflowX: "hidden" });
        const clip = el("div", "tab-clip", { scrollWidth: 400, clientWidth: 100, whiteSpace: "nowrap", overflowX: "clip" });
        const nowrapOnly = el("div", "spill", { scrollWidth: 400, clientWidth: 100, whiteSpace: "nowrap" });
        const hiddenOnly = el("div", "cut", { scrollWidth: 400, clientWidth: 100, overflowX: "hidden" });
        stubDocument({ ".wizard": el("div", "wizard", { children: [ellipsis, nowrap, clip, nowrapOnly, hiddenOnly] }) });
        const result = findOverflow(overflowArgs);
        expect(result.rootFound && result.findings.map((finding) => finding.where)).toEqual(["div.spill", "div.cut"]);
    });

    it("skips a visually hidden box (1 px, clipped) but not a small box that is not clipped", () => {
        const srOnly = el("span", "sr-only", { scrollWidth: 60, clientWidth: 1, clientHeight: 1, overflowX: "hidden", overflowY: "hidden" });
        const clipped = el("span", "clip-path", { scrollWidth: 60, clientWidth: 0, clientHeight: 1, clipPath: "inset(50%)" });
        const legacyClip = el("span", "legacy", { scrollWidth: 60, clientWidth: 1, clientHeight: 1, clip: "rect(0px, 0px, 0px, 0px)" });
        const thinButOpen = el("div", "thin", { scrollWidth: 60, clientWidth: 1, clientHeight: 1 });
        const bigAndClipped = el("div", "big", { scrollWidth: 600, clientWidth: 100, clientHeight: 20, overflowX: "hidden" });
        stubDocument({ ".wizard": el("div", "wizard", { children: [srOnly, clipped, legacyClip, thinButOpen, bigAndClipped] }) });
        const result = findOverflow(overflowArgs);
        expect(result.rootFound && result.findings.map((finding) => finding.where)).toEqual(["div.thin", "div.big"]);
    });

    it("reports at most the limit but counts every finding, and copes with an SVG's non-string className", () => {
        const children = Array.from({ length: 5 }, () => el("svg", { baseVal: "icon" }, { scrollWidth: 50, clientWidth: 10 }));
        stubDocument({ ".r": el("div", "r", { children }) });
        const result = findOverflow({ ...overflowArgs, root: ".r", limit: 3 });
        expect(result.rootFound && result.findings).toHaveLength(3);
        expect(result.rootFound && result.total).toBe(5);
        expect(result.rootFound && result.findings[0]?.where).toBe("svg");
    });
});

describe("findSmallTargets", () => {
    const args = { root: ".m", targets: "button", ignore: null as string | null, minSize: 44, limit: 10 };

    it("reports a missing root", () => {
        stubDocument({});
        expect(findSmallTargets(args)).toEqual({ rootFound: false });
    });

    it("flags a target smaller than 44 px in either direction, and takes 43.5 as 44 rounded", () => {
        const small = el("button", "save", { rect: { width: 120, height: 30 } });
        const narrow = el("button", "icon", { rect: { width: 20, height: 48 } });
        const fine = el("button", "ok", { rect: { width: 44, height: 44 } });
        const rounded = el("button", "edge", { rect: { width: 100, height: 43.6 } });
        stubDocument({ ".m": el("div", "m", { children: [small, narrow, fine, rounded] }) });
        expect(findSmallTargets(args)).toEqual({
            rootFound: true,
            findings: [
                { where: "button.save", detail: "120 x 30 px" },
                { where: "button.icon", detail: "20 x 48 px" },
            ],
            total: 2,
        });
    });

    it("uses the size asked for", () => {
        const button = el("button", "b", { rect: { width: 46, height: 46 } });
        stubDocument({ ".m": el("div", "m", { children: [button] }) });
        expect((findSmallTargets({ ...args, minSize: 48 }) as { findings: unknown[] }).findings).toHaveLength(1);
        expect((findSmallTargets({ ...args, minSize: 40 }) as { findings: unknown[] }).findings).toHaveLength(0);
    });

    it("honours the selector that decides what a target is", () => {
        const button = el("button", "b", { rect: { width: 10, height: 10 } });
        const asked: string[] = [];
        const root = el("div", "m", { children: [button] });
        root.querySelectorAll = (selector) => {
            asked.push(selector);
            return selector === ".tap" ? [button] : [];
        };
        stubDocument({ ".m": root });
        expect((findSmallTargets({ ...args, targets: ".tap" }) as { findings: unknown[] }).findings).toHaveLength(1);
        expect((findSmallTargets({ ...args, targets: "a" }) as { findings: unknown[] }).findings).toHaveLength(0);
        expect(asked).toEqual([".tap", "a"]);
    });

    it("skips hidden targets (no box, or visibility hidden) and ignored ones, but not a fixed one that has a box", () => {
        const none = el("button", "none", { rects: [], rect: { width: 10, height: 10 } });
        const invisible = el("button", "invisible", { visibility: "hidden", rect: { width: 10, height: 10 } });
        const ignored = el("button", "check", { rect: { width: 10, height: 10 }, closestMatches: [".row-check"] });
        const fixed = el("button", "fixed", { rect: { width: 10, height: 10 } });
        stubDocument({ ".m": el("div", "m", { children: [none, invisible, ignored, fixed] }) });
        const result = findSmallTargets({ ...args, ignore: ".row-check" });
        expect(result.rootFound && result.findings.map((finding) => finding.where)).toEqual(["button.fixed"]);
        expect((findSmallTargets(args) as { findings: unknown[] }).findings).toHaveLength(2);
    });

    it("reports at most the limit but counts every finding", () => {
        const children = Array.from({ length: 6 }, () => el("button", "s", { rect: { width: 10, height: 10 } }));
        stubDocument({ ".m": el("div", "m", { children }) });
        const result = findSmallTargets({ ...args, limit: 2 });
        expect(result.rootFound && result.findings).toHaveLength(2);
        expect(result.rootFound && result.total).toBe(6);
    });
});

describe("focusWalkStart", () => {
    it("focuses the first focusable element of the root that is shown and not disabled", () => {
        const hidden = el("button", "hidden", { rects: [] });
        const invisible = el("button", "invisible", { visibility: "hidden" });
        const disabled = el("button", "off", { disabled: true });
        const first = el("input", "name");
        stubDocument({ ".m": el("div", "m", { children: [hidden, invisible, disabled, first, el("button")] }) });
        expect(focusWalkStart({ root: ".m", from: null })).toBe("ok");
        expect(page.active).toBe(first);
    });

    it("focuses `from` instead when given, if it is inside the root", () => {
        const start = el("button", "go");
        const root = el("div", "m", { children: [el("input"), start] });
        stubDocument({ ".m": root, ".go": start });
        expect(focusWalkStart({ root: ".m", from: ".go" })).toBe("ok");
        expect(page.active).toBe(start);
    });

    it("refuses a `from` outside the root, without moving focus", () => {
        const outside = el("button", "ribbon");
        stubDocument({ ".m": el("div", "m", { children: [el("input")] }), ".ribbon": outside });
        expect(focusWalkStart({ root: ".m", from: ".ribbon" })).toBe("outside-root");
        expect(page.active).toBeNull();
    });

    it("says when a start does not take focus", () => {
        const stubborn = el("div", "stubborn", { focus: () => undefined });
        stubDocument({ ".m": el("div", "m", { children: [stubborn] }), ".stubborn": stubborn });
        expect(focusWalkStart({ root: ".m", from: ".stubborn" })).toBe("not-focused");
    });

    it("says when the root or the start is missing, or when nothing in the root can start a walk", () => {
        stubDocument({ ".m": el("div", "m", { children: [el("button", "", { rects: [] }), el("button", "", { disabled: true })] }) });
        expect(focusWalkStart({ root: ".nope", from: null })).toBe("no-root");
        expect(focusWalkStart({ root: ".m", from: null })).toBe("no-start");
        expect(focusWalkStart({ root: ".m", from: ".missing" })).toBe("no-start");
    });
});

describe("readFocusStop", () => {
    const OBSIDIAN_REST = "rgba(0, 0, 0, 0.1) 0px 1px 1px 0px";

    it("is null without a root or a focused element", () => {
        stubDocument({}, null);
        expect(readFocusStop(".m")).toBeNull();
        stubDocument({ ".m": el("div", "m") }, null);
        expect(readFocusStop(".m")).toBeNull();
    });

    it("sees an outline that appears with focus as a ring, and leaves the element focused", () => {
        const button = el("button", "go", { focused: { outlineStyle: "solid", outlineWidth: "2px" } });
        stubDocument({ ".m": el("div", "m", { children: [button] }) }, button);
        expect(readFocusStop(".m")).toMatchObject({ inRoot: true, repeat: false, where: "button.go", hasRing: true });
        expect(page.active).toBe(button);
    });

    it("sees a box-shadow that appears with focus as a ring", () => {
        const input = el("input", "name", { focused: { boxShadow: "0 0 0 2px blue" } });
        stubDocument({ ".m": el("div", "m", { children: [input] }) }, input);
        expect(readFocusStop(".m")?.hasRing).toBe(true);
    });

    it("does not take a resting box-shadow for a ring: a button whose focus ring was removed is reported", () => {
        const stripped = el("button", "stripped", { boxShadow: OBSIDIAN_REST });
        stubDocument({ ".m": el("div", "m", { children: [stripped] }) }, stripped);
        expect(readFocusStop(".m")).toMatchObject({ hasRing: false, detail: `focus changes neither the outline (none 0px rgb(0, 0, 0)) nor the box-shadow (${OBSIDIAN_REST})` });
    });

    it("passes a button whose resting shadow gets a ring on focus", () => {
        const normal = el("button", "normal", { boxShadow: OBSIDIAN_REST, focused: { boxShadow: `${OBSIDIAN_REST}, rgb(0, 0, 255) 0px 0px 0px 2px` } });
        stubDocument({ ".m": el("div", "m", { children: [normal] }) }, normal);
        expect(readFocusStop(".m")?.hasRing).toBe(true);
    });

    it("does not count an outline that is there without focus, or an outline of width 0", () => {
        const always = el("a", "always", { outlineStyle: "solid", outlineWidth: "2px" });
        const zero = el("a", "zero", { focused: { outlineStyle: "solid", outlineWidth: "0px" } });
        stubDocument({ ".m": el("div", "m", { children: [always, zero] }) }, always);
        expect(readFocusStop(".m")?.hasRing).toBe(false);
        stubDocument({ ".m": el("div", "m", { children: [always, zero] }) }, zero);
        expect(readFocusStop(".m")?.hasRing).toBe(false);
    });

    it("switches transitions off for the reads and removes the style afterwards", () => {
        const button = el("button", "b");
        stubDocument({ ".m": el("div", "m", { children: [button] }) }, button);
        readFocusStop(".m");
        expect(page.styleSheets).toBe(0);
    });

    it("reports an element outside the root, so the walk can end", () => {
        const outside = el("button", "ribbon");
        stubDocument({ ".m": el("div", "m") }, outside);
        expect(readFocusStop(".m")).toMatchObject({ inRoot: false, where: "button.ribbon" });
    });

    it("notices an element that a walk visits a second time", () => {
        const first = el("button", "first");
        const second = el("button", "second");
        stubDocument({ ".m": el("div", "m", { children: [first, second] }) }, first);
        expect(focusWalkStart({ root: ".m", from: null })).toBe("ok");
        expect(readFocusStop(".m")?.repeat).toBe(false);
        page.active = second;
        expect(readFocusStop(".m")?.repeat).toBe(false);
        page.active = first;
        expect(readFocusStop(".m")?.repeat).toBe(true);
    });
});

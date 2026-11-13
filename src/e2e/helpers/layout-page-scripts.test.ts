import { afterEach, describe, expect, it, vi } from "vitest";
import { findOverflow, findSmallTargets, focusWalkStart, readFocusStop } from "./layout-page-scripts.js";

interface FakeElement {
    tagName: string;
    id: string;
    className: unknown;
    scrollWidth: number;
    clientWidth: number;
    offsetParent: unknown;
    overflowX: string;
    outlineStyle: string;
    outlineWidth: string;
    boxShadow: string;
    rect: { width: number; height: number };
    children: FakeElement[];
    closestMatches: string[];
    focus: () => void;
    getBoundingClientRect: () => { width: number; height: number };
    querySelectorAll: (selector: string) => FakeElement[];
    closest: (selector: string) => unknown;
    contains: (other: unknown) => boolean;
}

function el(tagName: string, className: unknown = "", extra: Partial<FakeElement> = {}): FakeElement {
    const element: FakeElement = {
        tagName: tagName.toUpperCase(),
        id: "",
        className,
        scrollWidth: 100,
        clientWidth: 100,
        offsetParent: {},
        overflowX: "visible",
        outlineStyle: "none",
        outlineWidth: "0px",
        boxShadow: "none",
        rect: { width: 100, height: 100 },
        children: [],
        closestMatches: [],
        focus: () => undefined,
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
    const all = Object.values(selectors);
    vi.stubGlobal("document", { querySelector: (selector: string) => selectors[selector] ?? null, activeElement: active });
    vi.stubGlobal("getComputedStyle", (element: FakeElement) => {
        const known = all.concat(...all.map((item) => item.children)).find((item) => item === element) ?? element;
        return { overflowX: known.overflowX, outlineStyle: known.outlineStyle, outlineWidth: known.outlineWidth, boxShadow: known.boxShadow };
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("findOverflow", () => {
    it("reports a missing root", () => {
        stubDocument({});
        expect(findOverflow({ root: ".nope", limit: 10 })).toEqual({ rootFound: false });
    });

    it("finds nothing when everything fits, with one pixel of rounding allowed", () => {
        const child = el("div", "row", { scrollWidth: 101, clientWidth: 100 });
        const root = el("div", "wizard", { children: [child] });
        stubDocument({ ".wizard": root });
        expect(findOverflow({ root: ".wizard", limit: 10 })).toEqual({ rootFound: true, findings: [] });
    });

    it("names the root and the descendants that are wider than their box", () => {
        const wide = el("div", "row  big", { id: "r1", scrollWidth: 300, clientWidth: 200 });
        const root = el("div", "wizard", { scrollWidth: 420, clientWidth: 390, children: [wide, el("p")] });
        stubDocument({ ".wizard": root });
        expect(findOverflow({ root: ".wizard", limit: 10 })).toEqual({
            rootFound: true,
            findings: [
                { where: "div.wizard", detail: "scrollWidth 420 > clientWidth 390" },
                { where: "div#r1.row.big", detail: "scrollWidth 300 > clientWidth 200" },
            ],
        });
    });

    it("skips a descendant that scrolls on purpose, but not the root", () => {
        const code = el("pre", "code", { scrollWidth: 900, clientWidth: 200, overflowX: "auto" });
        const table = el("div", "table", { scrollWidth: 900, clientWidth: 200, overflowX: "scroll" });
        const root = el("div", "wizard", { scrollWidth: 400, clientWidth: 300, overflowX: "auto", children: [code, table] });
        stubDocument({ ".wizard": root });
        const result = findOverflow({ root: ".wizard", limit: 10 });
        expect(result).toEqual({ rootFound: true, findings: [{ where: "div.wizard", detail: "scrollWidth 400 > clientWidth 300" }] });
    });

    it("stops at the limit, and copes with an SVG's non-string className", () => {
        const children = Array.from({ length: 5 }, () => el("svg", { baseVal: "icon" }, { scrollWidth: 50, clientWidth: 10 }));
        const root = el("div", "r", { children });
        stubDocument({ ".r": root });
        const result = findOverflow({ root: ".r", limit: 3 });
        expect(result.rootFound && result.findings).toHaveLength(3);
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
        });
    });

    it("uses the size asked for", () => {
        const button = el("button", "b", { rect: { width: 46, height: 46 } });
        stubDocument({ ".m": el("div", "m", { children: [button] }) });
        expect(findSmallTargets({ ...args, minSize: 48 }).rootFound).toBe(true);
        expect((findSmallTargets({ ...args, minSize: 48 }) as { findings: unknown[] }).findings).toHaveLength(1);
        expect((findSmallTargets({ ...args, minSize: 40 }) as { findings: unknown[] }).findings).toHaveLength(0);
    });

    it("skips hidden targets and ignored ones, matched through their ancestors", () => {
        const hidden = el("button", "hidden", { offsetParent: null, rect: { width: 10, height: 10 } });
        const ignored = el("button", "check", { rect: { width: 10, height: 10 }, closestMatches: [".row-check"] });
        stubDocument({ ".m": el("div", "m", { children: [hidden, ignored] }) });
        expect(findSmallTargets({ ...args, ignore: ".row-check" })).toEqual({ rootFound: true, findings: [] });
        expect((findSmallTargets(args) as { findings: unknown[] }).findings).toHaveLength(1);
    });

    it("stops at the limit", () => {
        const children = Array.from({ length: 6 }, () => el("button", "s", { rect: { width: 10, height: 10 } }));
        stubDocument({ ".m": el("div", "m", { children }) });
        expect((findSmallTargets({ ...args, limit: 2 }) as { findings: unknown[] }).findings).toHaveLength(2);
    });
});

describe("focusWalkStart", () => {
    it("focuses the first focusable element of the root", () => {
        const first = el("input");
        let focused = 0;
        first.focus = () => (focused += 1);
        stubDocument({ ".m": el("div", "m", { children: [first, el("button")] }) });
        expect(focusWalkStart({ root: ".m", from: null })).toBe("ok");
        expect(focused).toBe(1);
    });

    it("focuses `from` instead when given", () => {
        let focused = "";
        const start = el("button", "go");
        start.focus = () => (focused = "go");
        stubDocument({ ".m": el("div", "m", { children: [el("input")] }), ".go": start });
        expect(focusWalkStart({ root: ".m", from: ".go" })).toBe("ok");
        expect(focused).toBe("go");
    });

    it("says when the root or the start is missing", () => {
        stubDocument({ ".m": el("div", "m") });
        expect(focusWalkStart({ root: ".nope", from: null })).toBe("no-root");
        expect(focusWalkStart({ root: ".m", from: null })).toBe("no-start");
        expect(focusWalkStart({ root: ".m", from: ".missing" })).toBe("no-start");
    });
});

describe("readFocusStop", () => {
    it("is null without a root or a focused element", () => {
        stubDocument({}, null);
        expect(readFocusStop(".m")).toBeNull();
        stubDocument({ ".m": el("div", "m") }, null);
        expect(readFocusStop(".m")).toBeNull();
    });

    it("sees an outline as a ring", () => {
        const button = el("button", "go", { outlineStyle: "solid", outlineWidth: "2px" });
        const root = el("div", "m", { children: [button] });
        stubDocument({ ".m": root }, button);
        expect(readFocusStop(".m")).toMatchObject({ inRoot: true, where: "button.go", hasRing: true });
    });

    it("sees a box-shadow as a ring, and an outline of width 0 as none", () => {
        const shadow = el("input", "name", { boxShadow: "0 0 0 2px blue" });
        const zero = el("a", "link", { outlineStyle: "solid", outlineWidth: "0px" });
        const root = el("div", "m", { children: [shadow, zero] });
        stubDocument({ ".m": root }, shadow);
        expect(readFocusStop(".m")?.hasRing).toBe(true);
        stubDocument({ ".m": root }, zero);
        expect(readFocusStop(".m")).toMatchObject({ hasRing: false, detail: "outline solid 0px, box-shadow none" });
    });

    it("reports an element outside the root, so the walk can end", () => {
        const outside = el("button", "ribbon");
        stubDocument({ ".m": el("div", "m") }, outside);
        expect(readFocusStop(".m")).toMatchObject({ inRoot: false, where: "button.ribbon" });
    });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installObsidianDom, uninstallObsidianDom } from "./install.js";

beforeEach(() => {
    installObsidianDom();
});
afterEach(() => {
    // Spies first: restoring one after the uninstall would put a helper back that the uninstall removed.
    vi.restoreAllMocks();
    uninstallObsidianDom();
    document.body.replaceChildren();
});

describe("install and uninstall", () => {
    it("is idempotent: a second install does not wrap or replace anything", () => {
        const first: unknown = Reflect.get(Node.prototype, "createDiv");
        installObsidianDom();
        expect(Reflect.get(Node.prototype, "createDiv")).toBe(first);
    });

    it("uninstall removes every helper and the globals, and a later install brings them back", () => {
        uninstallObsidianDom();
        expect("createDiv" in Node.prototype).toBe(false);
        expect("setText" in Element.prototype).toBe(false);
        expect("createEl" in globalThis).toBe(false);
        expect("activeWindow" in globalThis).toBe(false);
        expect("scrollIntoView" in Element.prototype).toBe(false);
        installObsidianDom();
        expect(document.body.createDiv().tagName).toBe("DIV");
        expect(activeDocument).toBe(document);
    });

    it("uninstall restores a property that existed before", () => {
        uninstallObsidianDom();
        const original = (): string => "mine";
        Object.defineProperty(Element.prototype, "setText", { value: original, configurable: true, writable: true });
        try {
            installObsidianDom();
            expect(Reflect.get(Element.prototype, "setText")).not.toBe(original);
            uninstallObsidianDom();
            expect(Reflect.get(Element.prototype, "setText")).toBe(original);
        } finally {
            uninstallObsidianDom();
            Reflect.deleteProperty(Element.prototype, "setText");
        }
    });

    it("uninstall without an install is a no-op", () => {
        uninstallObsidianDom();
        expect(() => {
            uninstallObsidianDom();
        }).not.toThrow();
    });

    it("keeps a native scrollIntoView and a pre-existing activeWindow", () => {
        uninstallObsidianDom();
        const native = vi.fn();
        Object.defineProperty(Element.prototype, "scrollIntoView", { value: native, configurable: true, writable: true });
        const marker = {};
        Object.defineProperty(globalThis, "activeWindow", { value: marker, configurable: true, writable: true });
        try {
            installObsidianDom();
            expect(Reflect.get(Element.prototype, "scrollIntoView")).toBe(native);
            expect(activeWindow).toBe(marker);
        } finally {
            uninstallObsidianDom();
            Reflect.deleteProperty(Element.prototype, "scrollIntoView");
            Reflect.deleteProperty(globalThis, "activeWindow");
        }
    });

    it("keeps an existing activeDocument and the show, hide and toggle that are already there", () => {
        uninstallObsidianDom();
        const mine = (): string => "mine";
        const document2 = {};
        const proto = HTMLElement.prototype;
        for (const key of ["show", "hide", "toggle"]) {
            Object.defineProperty(proto, key, { value: mine, configurable: true, writable: true });
        }
        Object.defineProperty(globalThis, "activeDocument", { value: document2, configurable: true, writable: true });
        try {
            installObsidianDom();
            for (const key of ["show", "hide", "toggle"]) expect(Reflect.get(proto, key)).toBe(mine);
            expect(activeDocument).toBe(document2);
            uninstallObsidianDom();
            // Nothing was installed under these keys, so the uninstall leaves them as they were.
            for (const key of ["show", "hide", "toggle"]) expect(Reflect.get(proto, key)).toBe(mine);
            expect(activeDocument).toBe(document2);
        } finally {
            uninstallObsidianDom();
            for (const key of ["show", "hide", "toggle"]) Reflect.deleteProperty(proto, key);
            Reflect.deleteProperty(globalThis, "activeDocument");
        }
    });

    it("adds a no-op scrollIntoView that jsdom lacks", () => {
        expect(() => {
            document.body.createDiv().scrollIntoView();
        }).not.toThrow();
    });
});

describe("globals", () => {
    it("activeWindow and activeDocument point at the one window and document", () => {
        expect(activeWindow).toBe(window);
        expect(activeDocument).toBe(document);
    });

    it("global createDiv/createSpan/createEl build detached elements", () => {
        const div = createDiv({ cls: "a" });
        const span = createSpan("b");
        const input = createEl("input", { type: "number", placeholder: "n", value: "3" });
        expect([div.parentNode, span.parentNode, input.parentNode]).toEqual([null, null, null]);
        expect(div.className).toBe("a");
        expect(span.className).toBe("b");
        expect(input.type).toBe("number");
        expect(input.placeholder).toBe("n");
        expect(input.value).toBe("3");
    });

    it("createFragment passes the fragment to the callback and returns it detached", () => {
        const fragment = createFragment((f) => {
            f.createEl("b", { text: "x" });
            f.appendText("y");
        });
        expect(fragment.childNodes).toHaveLength(2);
        expect(fragment.textContent).toBe("xy");
        expect(fragment.find("b")?.tagName).toBe("B");
        expect(fragment.findAll("b")).toHaveLength(1);
    });
});

describe("createEl family on nodes", () => {
    it("appends to the node and accepts a string as the class", () => {
        const parent = document.body;
        const child = parent.createDiv("one two");
        expect(child.parentNode).toBe(parent);
        expect(child.className).toBe("one two");
        expect(parent.createSpan().tagName).toBe("SPAN");
        expect(parent.createEl("p").tagName).toBe("P");
    });

    it("applies cls (array), text, attr (null skipped), title, href and runs the callback before returning", () => {
        const seen: string[] = [];
        const link = document.body.createEl(
            "a",
            { cls: ["x", "y"], text: "go", attr: { "data-n": 5, "data-b": true, gone: null }, title: "t", href: "https://example.com/" },
            (el) => seen.push(el.outerHTML),
        );
        expect(link.className).toBe("x y");
        expect(link.textContent).toBe("go");
        expect(link.getAttribute("data-n")).toBe("5");
        expect(link.getAttribute("data-b")).toBe("true");
        expect(link.hasAttribute("gone")).toBe(false);
        expect(link.title).toBe("t");
        expect(link.href).toBe("https://example.com/");
        expect(seen).toHaveLength(1);
    });

    it("runs the callback before the element is inserted, as the app does", () => {
        let parentInCallback: ParentNode | null | undefined;
        document.body.createDiv({}, (el) => {
            parentInCallback = el.parentNode;
        });
        expect(parentInCallback).toBeNull();
    });

    it("text accepts a DocumentFragment and appends it instead of stringifying it", () => {
        const fragment = createFragment((f) => f.createEl("em", { text: "hi" }));
        const div = document.body.createDiv({ text: fragment });
        expect(div.querySelector("em")?.textContent).toBe("hi");
        expect(div.textContent).toBe("hi");
    });

    it("prepend inserts as the first child; parent in the info inserts into that parent", () => {
        const host = document.body.createDiv();
        host.createSpan({ text: "last" });
        host.createEl("b", { text: "first", prepend: true });
        expect(host.firstElementChild?.tagName).toBe("B");
        const other = document.body.createDiv();
        createEl("i", { parent: other });
        expect(other.children).toHaveLength(1);
    });

    it("value and placeholder are ignored on elements that cannot take them; type sets a style attribute", () => {
        const div = createDiv({ text: "", placeholder: "p" });
        expect(div.getAttribute("placeholder")).toBeNull();
        expect(createEl("style", { type: "text/css" }).getAttribute("type")).toBe("text/css");
        expect(createEl("select").createEl("option", { value: "v" }).value).toBe("v");
    });

    it("on* functions in the info become event listeners", () => {
        const onclick = vi.fn();
        const button = document.body.createEl("button", { onclick } as DomElementInfo);
        button.click();
        expect(onclick).toHaveBeenCalledTimes(1);
    });

    it("removeEventListener with the same function stops an on* listener", () => {
        const onclick = vi.fn();
        const button = document.body.createEl("button", { onclick } as DomElementInfo);
        button.removeEventListener("click", onclick);
        button.click();
        expect(onclick).not.toHaveBeenCalled();
    });

    it("the global createEl does not mutate the info object it is given", () => {
        const info: DomElementInfo = { cls: "k" };
        createEl("div", info);
        expect(info).toEqual({ cls: "k" });
    });

    it("Node#createEl writes parent into the info object it is given, as the app does", () => {
        const info: DomElementInfo = { cls: "k" };
        const child = document.body.createDiv(info);
        expect(info).toEqual({ cls: "k", parent: document.body });
        expect(child.parentNode).toBe(document.body);
    });

    it("the public methods are the call path: createDiv and createSpan call createEl, createEl calls the global, which calls setText and setAttrs", () => {
        const nodeCreateEl = vi.spyOn(Node.prototype, "createEl");
        const globalCreateEl = vi.spyOn(globalThis, "createEl");
        const setText = vi.spyOn(Element.prototype, "setText");
        const setAttrs = vi.spyOn(Element.prototype, "setAttrs");
        document.body.createDiv({ text: "t", attr: { a: 1 } });
        document.body.createSpan("s");
        expect(nodeCreateEl).toHaveBeenCalledTimes(2);
        expect(nodeCreateEl.mock.calls.map((call) => call[0])).toEqual(["div", "span"]);
        expect(globalCreateEl).toHaveBeenCalledTimes(2);
        expect(globalCreateEl.mock.calls[0]?.[1]).toMatchObject({ text: "t", parent: document.body });
        expect(setText).toHaveBeenCalledWith("t");
        expect(setAttrs).toHaveBeenCalledWith({ a: 1 });
    });

    it("the global createDiv and createSpan call the global createEl", () => {
        const globalCreateEl = vi.spyOn(globalThis, "createEl");
        createDiv("a");
        createSpan({ cls: "b" });
        expect(globalCreateEl.mock.calls.map((call) => call[0])).toEqual(["div", "span"]);
    });

    it("works on a DocumentFragment (it is a Node)", () => {
        const fragment = document.createDocumentFragment();
        fragment.createDiv("in");
        expect(fragment.querySelector(".in")).not.toBeNull();
    });
});

describe("text and attributes", () => {
    it("setText replaces the children with text, stringifies non-strings and accepts nodes", () => {
        const el = document.body.createDiv();
        el.createSpan();
        el.setText("a");
        expect(el.childNodes).toHaveLength(1);
        expect(el.getText()).toBe("a");
        Reflect.apply(Reflect.get(el, "setText"), el, [5]);
        expect(el.textContent).toBe("5");
        const frag = createFragment((f) => f.createEl("i"));
        el.setText(frag);
        expect(el.querySelectorAll("i")).toHaveLength(1);
    });

    it("appendText adds a text node and keeps the children", () => {
        const el = document.body.createDiv();
        el.createSpan({ text: "a" });
        el.appendText("b");
        expect(el.textContent).toBe("ab");
        expect(el.lastChild?.nodeType).toBe(Node.TEXT_NODE);
    });

    it("empty removes every child", () => {
        const el = document.body.createDiv();
        el.createSpan();
        el.appendText("x");
        el.empty();
        expect(el.childNodes).toHaveLength(0);
    });

    it("setAttr stringifies, null removes; setAttrs applies a record; getAttr reads", () => {
        const el = document.body.createDiv();
        el.setAttr("data-n", 3);
        el.setAttr("data-b", false);
        expect(el.getAttr("data-n")).toBe("3");
        expect(el.getAttr("data-b")).toBe("false");
        el.setAttr("data-n", null);
        expect(el.getAttr("data-n")).toBeNull();
        el.setAttrs({ a: 1, b: null });
        expect(el.getAttr("a")).toBe("1");
        expect(el.hasAttribute("b")).toBe(false);
    });
});

describe("classes", () => {
    it("add/remove with several names, and the array variants", () => {
        const el = document.body.createDiv();
        el.addClass("a", "b");
        el.addClasses(["c"]);
        expect(el.className).toBe("a b c");
        el.removeClass("a", "b");
        el.removeClasses(["c"]);
        expect(el.className).toBe("");
        el.addClass();
        expect(el.className).toBe("");
    });

    it("hasClass reflects the list", () => {
        const el = document.body.createDiv("a");
        expect(el.hasClass("a")).toBe(true);
        expect(el.hasClass("b")).toBe(false);
    });

    it("toggleClass adds on true, removes on false and, as the app does, removes when the value is missing", () => {
        const el = document.body.createDiv();
        el.toggleClass("a", true);
        el.toggleClass(["b", "c"], true);
        expect(el.className).toBe("a b c");
        el.toggleClass("a", false);
        expect(el.hasClass("a")).toBe(false);
        (el.toggleClass as (c: string, v?: boolean) => void)("b");
        expect(el.hasClass("b")).toBe(false);
    });
});

describe("visibility and styles", () => {
    it("hide/show restore the previous inline display through data-display", () => {
        const el = document.body.createDiv();
        el.style.display = "flex";
        el.hide();
        expect(el.style.display).toBe("none");
        expect(el.getAttribute("data-display")).toBe("flex");
        el.hide();
        expect(el.getAttribute("data-display")).toBe("flex");
        el.show();
        expect(el.style.display).toBe("flex");
        expect(el.hasAttribute("data-display")).toBe(false);
    });

    it("hide on an element without inline display leaves no data-display; show on a visible element does nothing", () => {
        const el = document.body.createDiv();
        el.show();
        expect(el.style.display).toBe("");
        el.hide();
        expect(el.hasAttribute("data-display")).toBe(false);
        el.show();
        expect(el.style.display).toBe("");
    });

    it("hide clears a stale data-display when the previous display is empty", () => {
        const el = document.body.createDiv();
        el.setAttribute("data-display", "grid");
        el.hide();
        expect(el.hasAttribute("data-display")).toBe(false);
    });

    it("toggle(true/false) shows and hides", () => {
        const el = document.body.createDiv();
        el.toggle(false);
        expect(el.style.display).toBe("none");
        el.toggle(true);
        expect(el.style.display).toBe("");
    });

    it("isShown is false when detached or hidden on itself or an ancestor", () => {
        const outer = document.body.createDiv();
        const inner = outer.createDiv();
        expect(inner.isShown()).toBe(true);
        outer.hide();
        expect(inner.isShown()).toBe(false);
        outer.show();
        expect(createDiv().isShown()).toBe(false);
    });

    it("setCssStyles assigns properties; setCssProps sets custom properties", () => {
        const el = document.body.createDiv();
        el.setCssStyles({ color: "red", width: "5px" });
        expect(el.style.color).toBe("red");
        expect(el.style.width).toBe("5px");
        el.setCssProps({ "--x": "1", "margin-top": "2px" });
        expect(el.style.getPropertyValue("--x")).toBe("1");
        expect(el.style.marginTop).toBe("2px");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setCssProps({ "--y": "2" });
        svg.setCssStyles({ opacity: "0.5" });
        expect(svg.style.getPropertyValue("--y")).toBe("2");
        expect(svg.style.opacity).toBe("0.5");
    });
});

describe("queries and events", () => {
    it("find returns the first match or null; findAll an array; findAllSelf includes the element itself", () => {
        const root = document.body.createDiv("r");
        root.createSpan("s");
        root.createSpan("s");
        expect(root.find(".s")).toBe(root.firstElementChild);
        expect(root.find(".none")).toBeNull();
        expect(root.findAll(".s")).toHaveLength(2);
        expect(Array.isArray(root.findAll(".s"))).toBe(true);
        expect(root.findAllSelf(".r, .s")).toHaveLength(3);
        expect(root.findAllSelf(".s")).toHaveLength(2);
    });

    it("onClickEvent listens to click and auxclick", () => {
        const listener = vi.fn();
        const el = document.body.createDiv();
        el.onClickEvent(listener);
        el.dispatchEvent(new MouseEvent("click"));
        el.dispatchEvent(new MouseEvent("auxclick"));
        expect(listener).toHaveBeenCalledTimes(2);
    });
});

describe("window, document and instanceOf", () => {
    it("doc and win resolve from the node; constructorWin is the global window", () => {
        const el = document.body.createDiv();
        expect(el.doc).toBe(document);
        expect(el.win).toBe(document.defaultView);
        expect(el.constructorWin).toBe(window);
        expect(document.createDocumentFragment().doc).toBe(document);
    });

    it("instanceOf is true for the plain operator and false for an unrelated class", () => {
        const el = document.body.createDiv();
        expect(el.instanceOf(HTMLDivElement)).toBe(true);
        expect(el.instanceOf(Element)).toBe(true);
        expect(el.instanceOf(HTMLSpanElement)).toBe(false);
    });

    it("instanceOf finds the class of the node's own window by name (cross-window case)", () => {
        const el = document.body.createDiv();
        // Not the same class object, but the window holds the real one under that name, so it still matches.
        const lookalike = Object.defineProperty(function () { return undefined; }, "name", { value: "HTMLDivElement" });
        expect(el instanceof (lookalike as unknown as typeof HTMLDivElement)).toBe(false);
        expect(el.instanceOf(lookalike as unknown as typeof HTMLDivElement)).toBe(true);
    });
});

describe("Node: detach, insertAfter, indexOf, setChildrenInPlace", () => {
    it("detach removes the node from its parent and is a no-op without one", () => {
        const parent = document.body.createDiv();
        const child = parent.createSpan();
        child.detach();
        expect(parent.childNodes).toHaveLength(0);
        expect(() => {
            child.detach();
        }).not.toThrow();
    });

    it("insertAfter puts the node after the reference, first without one, and returns it", () => {
        const parent = document.body.createDiv();
        const a = parent.createSpan({ text: "a" });
        const c = parent.createSpan({ text: "c" });
        const b = document.createElement("i");
        expect(parent.insertAfter(b, a)).toBe(b);
        expect(Array.from(parent.childNodes)).toEqual([a, b, c]);
        const first = document.createElement("u");
        parent.insertAfter(first, null);
        expect(parent.firstChild).toBe(first);
        const last = document.createElement("s");
        parent.insertAfter(last, c);
        expect(parent.lastChild).toBe(last);
    });

    it("indexOf is the position among childNodes, text nodes included, or -1", () => {
        const parent = document.body.createDiv();
        parent.appendText("x");
        const span = parent.createSpan();
        expect(parent.indexOf(span)).toBe(1);
        expect(parent.indexOf(document.createElement("b"))).toBe(-1);
    });

    it("setChildrenInPlace reorders, removes the others and leaves a child that is already in place untouched", () => {
        const parent = document.body.createDiv();
        const [a, b, c, d] = ["a", "b", "c", "d"].map((text) => parent.createSpan({ text }));
        if (!a || !b || !c || !d) throw new Error("setup");
        const added = document.createElement("i");
        const removals: Node[] = [];
        const original = parent.removeChild.bind(parent);
        vi.spyOn(parent, "removeChild").mockImplementation(<T extends Node>(node: T): T => {
            removals.push(node);
            return original(node);
        });
        parent.setChildrenInPlace([a, added, c]);
        expect(Array.from(parent.childNodes)).toEqual([a, added, c]);
        expect(removals).toEqual([b, d]);
    });

    it("setChildrenInPlace with an empty list empties the node, and moves a node that is out of order", () => {
        const parent = document.body.createDiv();
        const a = parent.createSpan();
        const b = parent.createSpan();
        parent.setChildrenInPlace([b, a]);
        expect(Array.from(parent.childNodes)).toEqual([b, a]);
        parent.setChildrenInPlace([]);
        expect(parent.childNodes).toHaveLength(0);
    });
});

describe("createSvg", () => {
    it("creates an element in the SVG namespace with classes, attributes and a callback, and appends it to the parent", () => {
        const parent = document.body.createDiv();
        const svg = parent.createSvg("svg", { cls: ["a", "b"], attr: { width: 10, viewBox: "0 0 1 1", hidden: null } }, (el) => {
            el.setAttribute("data-cb", "1");
        });
        expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
        expect(svg.getAttribute("class")).toBe("a b");
        expect(svg.getAttribute("width")).toBe("10");
        expect(svg.getAttribute("data-cb")).toBe("1");
        expect(parent.firstChild).toBe(svg);
    });

    it("takes a string as the class, prepends with prepend and ignores text", () => {
        const parent = document.body.createDiv();
        parent.createSpan();
        const path = parent.createSvg("path", "icon");
        expect(path.classList.contains("icon")).toBe(true);
        const first = createSvg("g", { parent, prepend: true, text: "ignored" } as SvgElementInfo);
        expect(parent.firstChild).toBe(first);
        expect(first.textContent).toBe("");
    });

    it("the global createSvg has no parent unless given, and does not mutate the info", () => {
        const info: SvgElementInfo = { cls: "x" };
        const el = createSvg("circle", info);
        expect(el.parentNode).toBeNull();
        expect("parent" in info).toBe(false);
    });
});

describe("Element: matchParent, getCssPropertyValue, isActiveElement", () => {
    it("matchParent returns the element itself, an ancestor, or null", () => {
        const outer = document.body.createDiv("outer");
        const inner = outer.createDiv("inner").createSpan();
        expect(inner.matchParent("span")).toBe(inner);
        expect(inner.matchParent(".outer")).toBe(outer);
        expect(inner.matchParent(".nope")).toBeNull();
    });

    it("matchParent stops at lastParent, which is itself checked", () => {
        const outer = document.body.createDiv("outer");
        const mid = outer.createDiv("mid");
        const inner = mid.createSpan();
        expect(inner.matchParent(".outer", mid)).toBeNull();
        expect(inner.matchParent(".mid", mid)).toBe(mid);
    });

    it("getCssPropertyValue reads a computed value, trimmed", () => {
        const el = document.body.createDiv();
        el.style.setProperty("--gap", " 4px ");
        expect(el.getCssPropertyValue("--gap")).toBe("4px");
        el.style.color = "red";
        expect(el.getCssPropertyValue("color")).toBe("rgb(255, 0, 0)");
    });

    it("isActiveElement is true for the focused element of the active window and false otherwise", () => {
        const input = document.body.createEl("input");
        const other = document.body.createEl("input");
        input.focus();
        expect(input.isActiveElement()).toBe(true);
        expect(other.isActiveElement()).toBe(false);
    });

    it("isActiveElement is false when the window is not the active one, even if the element has focus", () => {
        const input = document.body.createEl("input");
        input.focus();
        const saved = activeWindow;
        Object.defineProperty(globalThis, "activeWindow", { value: {}, configurable: true, writable: true });
        try {
            expect(input.isActiveElement()).toBe(false);
        } finally {
            Object.defineProperty(globalThis, "activeWindow", { value: saved, configurable: true, writable: true });
        }
    });

    it("isActiveElement follows the frame chain: the frame element has to be the active one in its own document too", () => {
        const input = document.body.createEl("input");
        const frame = document.body.createEl("input");
        input.focus();
        Object.defineProperty(input, "win", { value: { frameElement: frame } });
        expect(input.isActiveElement()).toBe(false);
        Object.defineProperty(frame, "doc", { value: { activeElement: frame } });
        expect(input.isActiveElement()).toBe(true);
    });
});

describe("HTMLElement: toggleVisibility, innerWidth, addEventListeners, trigger", () => {
    it("toggleVisibility hides with visibility:hidden and shows by clearing it", () => {
        const el = document.body.createDiv();
        el.toggleVisibility(false);
        expect(el.style.visibility).toBe("hidden");
        el.toggleVisibility(true);
        expect(el.style.visibility).toBe("");
    });

    it("innerWidth and innerHeight are the scroll size minus padding; jsdom has no layout, so scroll size is 0", () => {
        const el = document.body.createDiv();
        el.style.padding = "3px 5px";
        expect(el.innerWidth).toBe(-10);
        expect(el.innerHeight).toBe(-6);
        const plain = document.body.createDiv();
        expect(plain.innerWidth).toBe(0);
    });

    it("addEventListeners registers the functions and skips other values", () => {
        const el = document.body.createDiv();
        const onClick = vi.fn();
        // Not in obsidian.d.ts, so it is looked up by name.
        const addEventListeners: unknown = Reflect.get(el, "addEventListeners");
        if (typeof addEventListeners !== "function") throw new Error("addEventListeners is not installed");
        Reflect.apply(addEventListeners, el, [{ click: onClick, custom: "not a function" }]);
        el.click();
        el.dispatchEvent(new Event("custom"));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("trigger dispatches a bubbling, non-cancelable event", () => {
        const parent = document.body.createDiv();
        const el = parent.createDiv();
        const seen: Event[] = [];
        parent.addEventListener("ping", (event) => seen.push(event));
        el.trigger("ping");
        expect(seen).toHaveLength(1);
        expect(seen[0]?.bubbles).toBe(true);
        expect(seen[0]?.cancelable).toBe(false);
    });
});

describe("delegated on / off", () => {
    it("calls the listener with the event and the matching ancestor of the target, with this = the element", () => {
        const root = document.body.createDiv();
        const item = root.createDiv("item");
        const label = item.createSpan();
        const seen: { self: unknown; match: Element }[] = [];
        root.on("click", ".item", function (_event, match) {
            seen.push({ self: this, match });
        });
        label.click();
        expect(seen).toEqual([{ self: root, match: item }]);
    });

    it("ignores a target that does not match and a target outside the delegating element's subtree match", () => {
        const root = document.body.createDiv();
        const other = root.createDiv("other");
        const listener = vi.fn();
        root.on("click", ".item", listener);
        other.click();
        expect(listener).not.toHaveBeenCalled();
    });

    it("off removes only the listener registered with the same selector, function and options", () => {
        const root = document.body.createDiv();
        const item = root.createDiv("item");
        const kept = vi.fn();
        const removed = vi.fn();
        root.on("click", ".item", kept);
        root.on("click", ".item", removed);
        root.on("click", ".item", removed, true);
        root.off("click", ".item", removed);
        root.off("click", ".nope", kept);
        item.click();
        expect(kept).toHaveBeenCalledTimes(1);
        expect(removed).toHaveBeenCalledTimes(1);
    });

    it("off without anything registered is a no-op, and on works on a document", () => {
        const root = document.body.createDiv();
        expect(() => {
            root.off("click", ".item", vi.fn());
        }).not.toThrow();
        const item = root.createDiv("item");
        const listener = vi.fn();
        document.on("click", ".item", listener);
        item.click();
        document.off("click", ".item", listener);
        item.click();
        expect(listener).toHaveBeenCalledTimes(1);
        root.on("click", ".x", vi.fn());
        root.off("focus", ".x", vi.fn());
    });
});

/** A mouse event whose `view` is the given object: jsdom's constructor accepts only a real Window. */
function mouseEventIn(view: unknown): MouseEvent {
    const event = new MouseEvent("click");
    Object.defineProperty(event, "view", { value: view });
    return event;
}

describe("UIEvent: targetNode, win, doc, instanceOf", () => {
    it("targetNode is the target, win the view or the window, doc the document of that window", () => {
        const el = document.body.createDiv();
        let seen: UIEvent | undefined;
        el.addEventListener("click", (event) => {
            seen = event;
        });
        el.click();
        expect(seen?.targetNode).toBe(el);
        expect(seen?.view).not.toBeNull();
        expect(seen?.win).toBe(seen?.view);
        expect(seen?.doc).toBe(document);
        expect(new UIEvent("x").win).toBe(window);
        const otherDocument = document.implementation.createHTMLDocument();
        const popout = mouseEventIn({ document: otherDocument });
        expect(popout.win).toHaveProperty("document", otherDocument);
        expect(popout.doc).toBe(otherDocument);
        expect(new UIEvent("x").targetNode).toBeNull();
    });

    it("instanceOf is true for the operator, true for another class of that name on the view, false without a view or for a different class", () => {
        const event = new MouseEvent("click");
        expect(event.instanceOf(MouseEvent)).toBe(true);
        expect(event.instanceOf(KeyboardEvent)).toBe(false);
        // Another window's MouseEvent, which this event is an instance of there but not here.
        const Foreign = Object.defineProperty(function MouseEvent() { return undefined; }, Symbol.hasInstance, { value: () => true });
        const foreignClass = mouseEventIn({ MouseEvent: Foreign });
        expect(foreignClass.instanceOf(MouseEvent)).toBe(true);
        const sameClass = mouseEventIn({ KeyboardEvent });
        expect(sameClass.instanceOf(KeyboardEvent)).toBe(false);
        expect(mouseEventIn({}).instanceOf(KeyboardEvent)).toBe(false);
    });
});

describe("global fish, fishAll, ready, sleep, nextFrame", () => {
    it("fish and fishAll query the document", () => {
        const a = document.body.createDiv("hit");
        const b = document.body.createDiv("hit");
        expect(fish(".hit")).toBe(a);
        expect(fishAll(".hit")).toEqual([a, b]);
        expect(fish(".none")).toBeNull();
        expect(fishAll(".none")).toEqual([]);
    });

    it("ready runs the callback at once once the document has loaded", () => {
        const callback = vi.fn();
        ready(callback);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it("ready waits for DOMContentLoaded while the document is loading", () => {
        const state = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
        const callback = vi.fn();
        ready(callback);
        expect(callback).not.toHaveBeenCalled();
        document.dispatchEvent(new Event("DOMContentLoaded"));
        expect(callback).toHaveBeenCalledTimes(1);
        state.mockRestore();
    });

    it("sleep resolves after the delay", async () => {
        vi.useFakeTimers();
        try {
            let done = false;
            const pending = sleep(50).then(() => {
                done = true;
            });
            await vi.advanceTimersByTimeAsync(49);
            expect(done).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await pending;
            expect(done).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("nextFrame resolves on the next animation frame", async () => {
        const callbacks: FrameRequestCallback[] = [];
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => callbacks.push(callback));
        const frame = nextFrame();
        expect(callbacks).toHaveLength(1);
        callbacks[0]?.(0);
        await expect(frame).resolves.toBeUndefined();
    });
});

describe("uninstall removes the later helpers", () => {
    it("takes every added helper away again", () => {
        uninstallObsidianDom();
        for (const key of ["detach", "insertAfter", "indexOf", "setChildrenInPlace", "createSvg"]) expect(key in Node.prototype).toBe(false);
        for (const key of ["matchParent", "getCssPropertyValue", "isActiveElement"]) expect(key in Element.prototype).toBe(false);
        for (const key of ["toggleVisibility", "innerWidth", "trigger", "on", "off", "addEventListeners"]) expect(key in HTMLElement.prototype).toBe(false);
        expect("targetNode" in UIEvent.prototype).toBe(false);
        for (const key of ["createSvg", "fish", "fishAll", "ready", "sleep", "nextFrame"]) expect(key in globalThis).toBe(false);
        installObsidianDom();
    });
});

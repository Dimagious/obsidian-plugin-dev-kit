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

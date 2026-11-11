/// <reference lib="dom" />
import type {} from "obsidian";
import {
    createChild,
    createElement,
    createFragment,
    getText,
    hide,
    instanceOf,
    isShown,
    setAttr,
    setAttrs,
    setCssProps,
    setCssStyles,
    setText,
    show,
    toggleClass,
} from "./elements.js";

type Original = PropertyDescriptor | undefined;

/** What was there before the install, per object and key, so `uninstallObsidianDom()` can put it back. */
const originals = new Map<object, Map<PropertyKey, Original>>();
/** The prototype the helpers were installed on; a different one means vitest handed out a new DOM. */
let installedOn: object | undefined;

function define(target: object, key: PropertyKey, descriptor: PropertyDescriptor, onlyIfMissing = false): void {
    if (onlyIfMissing && key in target) return;
    let saved = originals.get(target);
    if (!saved) {
        saved = new Map();
        originals.set(target, saved);
    }
    if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(target, key));
    Object.defineProperty(target, key, { configurable: true, enumerable: false, ...descriptor });
}

function method(target: object, key: string, value: (...args: never[]) => unknown, onlyIfMissing = false): void {
    define(target, key, { value, writable: true }, onlyIfMissing);
}

function getter(target: object, key: string, get: () => unknown): void {
    define(target, key, { get });
}

/**
 * Installs Obsidian's DOM helpers (`createDiv`, `setText`, `addClass`, `activeDocument`, the global `createEl`, ...)
 * on the current jsdom. The list and the behaviour follow the app's own implementation (see `elements.ts`).
 * Calling it again is a no-op. Throws when there is no DOM: run the test file in the jsdom environment.
 */
export function installObsidianDom(): void {
    if (typeof document === "undefined" || typeof Node === "undefined") {
        throw new Error(
            "installObsidianDom() needs a DOM and this test runs in the node environment. " +
                "Add `// @vitest-environment jsdom` to the top of the test file, or list the file in the `dom` option of defineUnitConfig().",
        );
    }
    if (installedOn === Node.prototype) return;
    // Within one module instance there is one jsdom window, so Node.prototype never changes and `installedOn` is
    // only unset by uninstall(), which has already emptied `originals`. The clear() is a guard for a Vitest that would
    // reuse this module with a fresh DOM; it cannot be reached from a test.
    originals.clear();
    installedOn = Node.prototype;

    // Node
    const node = Node.prototype;
    getter(node, "doc", function (this: Node) {
        return this.ownerDocument ?? document;
    });
    getter(node, "win", function (this: Node) {
        return this.doc.defaultView ?? window;
    });
    define(node, "constructorWin", { value: window, writable: true });
    method(node, "empty", function (this: Node) {
        while (this.lastChild) this.removeChild(this.lastChild);
    });
    method(node, "appendText", function (this: Node, text: string) {
        this.appendChild(document.createTextNode(text));
    });
    method(node, "instanceOf", function (this: Node, type: abstract new () => unknown) {
        return instanceOf(this, type);
    });
    method(node, "createEl", function (this: Node, tag: keyof HTMLElementTagNameMap, info?: DomElementInfo | string, cb?: (el: HTMLElement) => void) {
        return createChild(this, tag, info, cb);
    });
    // createDiv and createSpan go through this.createEl(), and the globals through the global createEl, as in the app.
    method(node, "createDiv", function (this: Node, info?: DomElementInfo | string, cb?: (el: HTMLDivElement) => void) {
        return this.createEl("div", info, cb);
    });
    method(node, "createSpan", function (this: Node, info?: DomElementInfo | string, cb?: (el: HTMLSpanElement) => void) {
        return this.createEl("span", info, cb);
    });

    // Element
    const element = Element.prototype;
    method(element, "setText", function (this: Element, value: unknown) {
        setText(this, value);
    });
    method(element, "getText", function (this: Element) {
        return getText(this);
    });
    method(element, "setAttr", function (this: Element, name: string, value: string | number | boolean | null) {
        setAttr(this, name, value);
    });
    method(element, "setAttrs", function (this: Element, attrs: Record<string, string | number | boolean | null>) {
        setAttrs(this, attrs);
    });
    method(element, "getAttr", function (this: Element, name: string) {
        return this.getAttribute(name);
    });
    method(element, "addClass", function (this: Element, ...classes: string[]) {
        this.addClasses(classes);
    });
    method(element, "addClasses", function (this: Element, classes: string[]) {
        for (const cls of classes) this.classList.add(cls);
    });
    method(element, "removeClass", function (this: Element, ...classes: string[]) {
        this.removeClasses(classes);
    });
    method(element, "removeClasses", function (this: Element, classes: string[]) {
        for (const cls of classes) this.classList.remove(cls);
    });
    method(element, "toggleClass", function (this: Element, classes: string | string[], value: boolean | undefined) {
        toggleClass(this, classes, value);
    });
    method(element, "hasClass", function (this: Element, cls: string) {
        return this.classList.contains(cls);
    });
    method(element, "find", function (this: Element, selector: string) {
        return this.querySelector(selector);
    });
    method(element, "findAll", function (this: Element, selector: string) {
        return Array.from(this.querySelectorAll(selector));
    });
    method(element, "findAllSelf", function (this: Element, selector: string) {
        const found = Array.from(this.querySelectorAll(selector));
        if (this.matches(selector)) found.unshift(this);
        return found;
    });
    // jsdom has no layout engine and no scrollIntoView; browsers (and the app) have it, tests need a no-op.
    method(
        element,
        "scrollIntoView",
        function () {
            /* nothing to scroll without layout */
        },
        true,
    );

    // DocumentFragment: find and findAll only (it is a Node, so the create helpers come from there).
    const fragment = DocumentFragment.prototype;
    method(fragment, "find", function (this: DocumentFragment, selector: string) {
        return this.querySelector(selector);
    });
    method(fragment, "findAll", function (this: DocumentFragment, selector: string) {
        return Array.from(this.querySelectorAll(selector));
    });

    // HTMLElement
    const html = HTMLElement.prototype;
    method(html, "show", function (this: HTMLElement) {
        show(this);
    }, true);
    method(html, "hide", function (this: HTMLElement) {
        hide(this);
    }, true);
    method(html, "toggle", function (this: HTMLElement, visible: boolean) {
        if (visible) this.show();
        else this.hide();
    }, true);
    method(html, "isShown", function (this: HTMLElement) {
        return isShown(this);
    });
    method(html, "setCssStyles", function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
        setCssStyles(this, styles);
    });
    method(html, "setCssProps", function (this: HTMLElement, props: Record<string, string>) {
        setCssProps(this, props);
    });
    method(html, "onClickEvent", function (this: HTMLElement, listener: (ev: MouseEvent) => unknown, options?: boolean | AddEventListenerOptions) {
        this.addEventListener("click", listener, options);
        this.addEventListener("auxclick", listener, options);
    });
    method(SVGElement.prototype, "setCssStyles", function (this: SVGElement, styles: Partial<CSSStyleDeclaration>) {
        setCssStyles(this, styles);
    });
    method(SVGElement.prototype, "setCssProps", function (this: SVGElement, props: Record<string, string>) {
        setCssProps(this, props);
    });

    // Globals the app puts on `window`. Here `window` is the global scope vitest builds from jsdom.
    method(globalThis, "createEl", createElement);
    method(globalThis, "createDiv", (info?: DomElementInfo | string, cb?: (el: HTMLDivElement) => void) =>
        createEl("div", info, cb),
    );
    method(globalThis, "createSpan", (info?: DomElementInfo | string, cb?: (el: HTMLSpanElement) => void) =>
        createEl("span", info, cb),
    );
    method(globalThis, "createFragment", createFragment);
    // One window only, so the active window and document are the global ones.
    define(globalThis, "activeWindow", { value: window, writable: true }, true);
    define(globalThis, "activeDocument", { value: document, writable: true }, true);
}

/** Puts back what `installObsidianDom()` replaced and removes what it added. Safe to call when nothing is installed. */
export function uninstallObsidianDom(): void {
    for (const [target, saved] of originals) {
        for (const [key, original] of saved) {
            if (original) Object.defineProperty(target, key, original);
            else Reflect.deleteProperty(target, key);
        }
    }
    originals.clear();
    installedOn = undefined;
}

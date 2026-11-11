/// <reference lib="dom" />
// Obsidian's global augmentations of the DOM (DomElementInfo, Node#createEl, ...) are declared by its own types.
import type {} from "obsidian";

/*
 * The helpers below are Obsidian's own DOM extensions, ported for jsdom. Behaviour was read from the shipped app
 * (Obsidian 1.14.5, `obsidian.asar`, `enhance.js`, the script that installs the extensions) and checked against
 * `obsidian.d.ts` 1.14.4. Where jsdom cannot do what the app does, the comment says so.
 */

type ElementInfo = DomElementInfo | string;

function isListener(value: unknown): value is EventListener {
    return typeof value === "function";
}

function normalize(info: ElementInfo | undefined): DomElementInfo {
    return typeof info === "string" ? { cls: info } : (info ?? {});
}

/**
 * `createEl()` of the app: a string is shorthand for `{ cls }`; `cls` (string or array), `text`, `attr` (a null value
 * removes the attribute), `title`, `value` (input, select, option), `type` (input; a `<style>` gets it as an
 * attribute), `placeholder` (input), `href` (a, link, base) are applied in that order; then the callback runs, then
 * the element is inserted into `parent` (first, with `prepend`); then every `on*` function in the info is registered
 * as an event listener (`addEventListener(key.substring(2), fn)`, the function itself, so `removeEventListener`
 * with the same function removes it). The info is not mutated. The text and the attributes go through the
 * installed `el.setText()` and `el.setAttrs()`, as in the app.
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    info?: ElementInfo,
    callback?: (el: HTMLElementTagNameMap[K]) => void,
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    const { cls, text, attr, title, value, type, placeholder, href, parent, prepend } = normalize(info);
    if (cls) el.className = Array.isArray(cls) ? cls.join(" ") : cls;
    if (text) el.setText(text);
    if (attr) el.setAttrs(attr);
    if (title !== undefined) el.title = title;
    if (value !== undefined && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLOptionElement)) {
        el.value = value;
    }
    if (type && el instanceof HTMLInputElement) el.type = type;
    if (type && el instanceof HTMLStyleElement) el.setAttribute("type", type);
    if (placeholder && el instanceof HTMLInputElement) el.placeholder = placeholder;
    if (href && (el instanceof HTMLAnchorElement || el instanceof HTMLLinkElement || el instanceof HTMLBaseElement)) el.href = href;
    callback?.(el);
    if (parent) {
        if (prepend) parent.insertBefore(el, parent.firstChild);
        else parent.appendChild(el);
    }
    for (const [key, handler] of Object.entries(normalize(info))) {
        if (key.startsWith("on") && isListener(handler)) el.addEventListener(key.substring(2), handler);
    }
    return el;
}

/**
 * `Node#createEl`: the global `createEl` with `parent` set to the node. As in the app, `parent` is written into the
 * info object the caller passed (a string becomes a new `{ cls }` object).
 */
export function createChild<K extends keyof HTMLElementTagNameMap>(
    parent: Node,
    tag: K,
    info?: ElementInfo,
    callback?: (el: HTMLElementTagNameMap[K]) => void,
): HTMLElementTagNameMap[K] {
    const given = normalize(info);
    given.parent = parent;
    return createEl(tag, given, callback);
}

/** `createFragment()` of the app: a detached fragment, passed to the callback first. */
export function createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment {
    const fragment = document.createDocumentFragment();
    callback?.(fragment);
    return fragment;
}

/** `Element#setText`: a Node or fragment replaces the children, anything else is stringified into textContent. */
export function setText(el: Element, value: unknown): void {
    if (value instanceof Node) {
        el.empty();
        el.appendChild(value);
        return;
    }
    el.textContent = String(value);
}

/** `Element#setAttr`: null removes the attribute, anything else is stringified. */
export function setAttr(el: Element, name: string, value: string | number | boolean | null): void {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, String(value));
}

/** `Element#setAttrs`: `setAttr` for every own key. */
export function setAttrs(el: Element, attrs: Record<string, string | number | boolean | null>): void {
    for (const [name, value] of Object.entries(attrs)) setAttr(el, name, value);
}

/** The app's `getText()`: the text content, as the DOM defines it for elements, documents and fragments. */
export function getText(el: Element): string {
    return el.textContent;
}

/** `Element#toggleClass`: the value is truthy to add and falsy to remove, so `undefined` removes (as in the app). */
export function toggleClass(el: Element, classes: string | string[], value: boolean | undefined): void {
    const list = Array.isArray(classes) ? classes : [classes];
    if (value) el.addClasses(list);
    else el.removeClasses(list);
}

/**
 * `HTMLElement#hide`: remember an inline display value in `data-display`, then set `display: none`. Does nothing
 * when it is already hidden.
 */
export function hide(el: HTMLElement): void {
    const previous = el.style.display;
    if (previous === "none") return;
    el.style.display = "none";
    if (previous) el.setAttribute("data-display", previous);
    else el.removeAttribute("data-display");
}

/** `HTMLElement#show`: undo `hide()`, restoring the remembered display value. Does nothing unless hidden. */
export function show(el: HTMLElement): void {
    if (el.style.display !== "none") return;
    el.style.display = el.getAttribute("data-display") ?? "";
    el.removeAttribute("data-display");
}

/**
 * `HTMLElement#isShown`. The app returns `!!offsetParent`, which jsdom (no layout) always reports as null, so a
 * literal port would say false for everything. This one is true for an element that is in the document and has
 * no inline `display: none` on itself or an ancestor.
 */
export function isShown(el: HTMLElement): boolean {
    if (!el.isConnected) return false;
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        if (node.style.display === "none") return false;
    }
    return true;
}

/** `setCssStyles`: assign every own property to `style`. */
export function setCssStyles(el: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>): void {
    Object.assign(el.style, styles);
}

/** `setCssProps`: `style.setProperty` for every own key, so custom properties (`--x`) work. */
export function setCssProps(el: HTMLElement | SVGElement, props: Record<string, string>): void {
    for (const [name, value] of Object.entries(props)) el.style.setProperty(name, value);
}

/**
 * `Node#instanceOf`: the plain operator, then the same class looked up by name on the node's own window and on the
 * window the app's code runs in. With the one jsdom window of a test the `constructorWin` lookup finds what the
 * `win` lookup found, so only the first two steps are reachable (and tested); the third is kept for parity.
 */
export function instanceOf(node: Node, type: abstract new () => unknown): boolean {
    if (node instanceof type) return true;
    const lookup = (window: Window): boolean => {
        const candidate: unknown = Reflect.get(window, type.name);
        return typeof candidate === "function" && node instanceof candidate;
    };
    return lookup(node.win) || lookup(node.constructorWin);
}

/**
 * Functions Playwright serializes and runs inside Obsidian, for the `demo` fixture. Like `../helpers/page-scripts.ts`,
 * each one must be self-contained: only its source text crosses into the page. The kit's TypeScript has no DOM types,
 * hence the small interfaces below.
 */

import type { PartialApp } from "../internals.js";

/** The overlay's commands, as the page API takes them. */
export type OverlayCall =
    | { method: "caption"; arg: string | null }
    | { method: "pointer"; arg: "cursor" | "tap" }
    | { method: "hidePointer"; arg: null }
    | { method: "cursorEnabled"; arg: boolean }
    | { method: "clean"; arg: { statusBar: boolean; tabHeaders: boolean } };

interface OverlayApi {
    caption(text: string | null): void;
    pointer(kind: "cursor" | "tap"): void;
    hidePointer(): void;
    cursorEnabled(enabled: boolean): void;
    clean(hide: { statusBar: boolean; tabHeaders: boolean }): void;
}

interface PageClassList {
    add(name: string): void;
    remove(name: string): void;
    toggle(name: string, force: boolean): void;
}

interface PageNode {
    id: string;
    textContent: string | null;
    innerHTML: string;
    style: { left: string; top: string; display: string };
    classList: PageClassList;
}

interface PageDocument {
    readyState: string;
    documentElement: (PageNode & { append(...nodes: PageNode[]): void }) | null;
    createElement(tag: string): PageNode;
    getElementById(id: string): PageNode | null;
    addEventListener(type: string, listener: () => void, options: { once: boolean }): void;
    getAnimations?(): PageAnimation[];
    activeElement?: { tagName: string; isContentEditable?: boolean; type?: string } | null;
}

interface PageAnimation {
    effect: { getComputedTiming(): { endTime: number | string } } | null;
    playState?: string;
    finish(): void;
    pause(): void;
    play(): void;
}

interface MouseLikeEvent {
    clientX: number;
    clientY: number;
}

interface OverlayGlobals {
    document?: PageDocument;
    sessionStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
    addEventListener?(type: string, listener: (event: MouseLikeEvent) => void, capture: boolean): void;
    requestAnimationFrame?(callback: () => void): number;
    setTimeout?(callback: () => void, ms: number): number;
    innerWidth?: number;
    innerHeight?: number;
    devicePixelRatio?: number;
    __opdkDemo?: OverlayApi;
    /** The endless animations `freezeForShot` paused, for `releaseShot` to play again. */
    __opdkPaused?: PageAnimation[];
    app?: PartialApp;
}

/**
 * The look of the overlays and of the freeze, in one place so the tests can check what the page gets. No transition
 * or animation on the overlays: a CDP capture does not wait for them (a tap dot caught mid-shrink showed in a spike
 * frame), so every state change must land at once.
 */
export const OVERLAY_CSS = [
    // The caption sits one level below the pointers: a cursor or a tap dot over the bar stays visible.
    "#opdk-cursor,#opdk-tap,#opdk-caption{position:fixed;display:none;pointer-events:none;z-index:2147483646;transition:none;animation:none}",
    "#opdk-cursor,#opdk-tap{z-index:2147483647}",
    "#opdk-cursor{left:0;top:0;width:22px;height:22px;transform-origin:0 0;filter:drop-shadow(1px 1px 2px rgba(0,0,0,.35))}",
    "#opdk-cursor.opdk-down{transform:scale(.85)}",
    "#opdk-tap{width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;box-sizing:border-box;background:rgba(128,128,140,.38);border:1.5px solid rgba(128,128,140,.55)}",
    "#opdk-tap.opdk-down{width:36px;height:36px;margin:-18px 0 0 -18px}",
    "#opdk-caption{left:50%;bottom:24px;transform:translateX(-50%);max-width:min(720px,80vw);padding:10px 22px;border-radius:10px;background:rgba(15,15,18,.82);color:#fff;font:500 17px/1.4 system-ui,-apple-system,sans-serif;text-align:center}",
    "html.opdk-hide-status-bar .status-bar{display:none !important}",
    "html.opdk-hide-tab-headers .workspace-tab-header-container{display:none !important}",
    "html.opdk-shooting *,html.opdk-shooting *::before,html.opdk-shooting *::after{transition:none !important;caret-color:transparent !important}",
    "html.opdk-shooting .cm-cursorLayer{visibility:hidden !important}",
].join("\n");

/** The arrow of the demo cursor. */
export const CURSOR_SVG =
    '<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M5 3L19 12L12 13L9 20L5 3Z" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/></svg>';

/**
 * Init script of the Obsidian window (`context.addInitScript`), also run once in the page that is already up. It
 * draws the cursor, the tap dot and the caption bar into `<html>`, outside Obsidian's `<body>`, above every modal. The
 * state (pointer position and kind, caption, hidden UI parts) lives in `sessionStorage`, so a document that replaces
 * this one (`reload()`, `mobile()`, `desktop()`) restores it. Captions go in through `textContent`: markup shows literally.
 * Idempotent. The look comes in as the argument because only the function's own source text reaches the page.
 */
export function installOverlay(assets: { cssText: string; cursorSvg: string }): void {
    const globals = globalThis as unknown as OverlayGlobals;
    if (globals.__opdkDemo !== undefined || globals.document === undefined) {
        return;
    }
    const doc = globals.document;
    const KEY = "opdk-demo-state";
    interface State {
        caption?: string;
        x?: number;
        y?: number;
        kind?: "cursor" | "tap";
        hidden?: boolean;
        /** The cursor arrow is off for the film being shot; mouse moves do not bring it back. */
        cursorOff?: boolean;
        hideStatusBar?: boolean;
        hideTabHeaders?: boolean;
    }
    const read = (): State => {
        try {
            return JSON.parse(globals.sessionStorage?.getItem(KEY) ?? "{}") as State;
        } catch {
            return {};
        }
    };
    let state: State = read();
    const save = (patch: State): void => {
        state = { ...state, ...patch };
        try {
            globals.sessionStorage?.setItem(KEY, JSON.stringify(state));
        } catch {
            // Storage refused (a private window, a quota): the overlays still work for this document, they just do not survive a reload.
        }
    };
    let cursor: PageNode | null = null;
    let tap: PageNode | null = null;
    let caption: PageNode | null = null;
    const render = (): void => {
        if (cursor === null || tap === null || caption === null) {
            return;
        }
        const placed = state.x !== undefined && state.y !== undefined && state.hidden !== true;
        const x = `${String(state.x ?? 0)}px`;
        const y = `${String(state.y ?? 0)}px`;
        cursor.style.left = tap.style.left = x;
        cursor.style.top = tap.style.top = y;
        cursor.style.display = placed && state.kind !== "tap" && state.cursorOff !== true ? "block" : "none";
        tap.style.display = placed && state.kind === "tap" ? "block" : "none";
        caption.textContent = state.caption ?? "";
        caption.style.display = state.caption !== undefined && state.caption !== "" ? "block" : "none";
        const root = doc.documentElement;
        root?.classList.toggle("opdk-hide-status-bar", state.hideStatusBar === true);
        root?.classList.toggle("opdk-hide-tab-headers", state.hideTabHeaders === true);
    };
    const mount = (): void => {
        const root = doc.documentElement;
        if (root === null || doc.getElementById("opdk-cursor") !== null) {
            return;
        }
        const style = doc.createElement("style");
        style.id = "opdk-overlay-style";
        style.textContent = assets.cssText;
        cursor = doc.createElement("div");
        cursor.id = "opdk-cursor";
        cursor.innerHTML = assets.cursorSvg;
        tap = doc.createElement("div");
        tap.id = "opdk-tap";
        caption = doc.createElement("div");
        caption.id = "opdk-caption";
        // Caption first: among equal layers the later element is on top, and the pointers must be.
        root.append(style, caption, cursor, tap);
        render();
    };
    globals.addEventListener?.(
        "mousemove",
        (event) => {
            save({ x: event.clientX, y: event.clientY, hidden: false });
            render();
        },
        true,
    );
    globals.addEventListener?.(
        "mousedown",
        () => {
            cursor?.classList.add("opdk-down");
            tap?.classList.add("opdk-down");
        },
        true,
    );
    globals.addEventListener?.(
        "mouseup",
        () => {
            cursor?.classList.remove("opdk-down");
            tap?.classList.remove("opdk-down");
        },
        true,
    );
    globals.__opdkDemo = {
        caption: (text) => {
            save({ caption: text ?? "" });
            render();
        },
        pointer: (kind) => {
            save({ kind });
            render();
        },
        hidePointer: () => {
            save({ hidden: true });
            render();
        },
        cursorEnabled: (enabled) => {
            save({ cursorOff: !enabled });
            render();
        },
        clean: (hide) => {
            save({ hideStatusBar: hide.statusBar, hideTabHeaders: hide.tabHeaders });
            render();
        },
    };
    if (doc.readyState === "loading") {
        doc.addEventListener("DOMContentLoaded", mount, { once: true });
    } else {
        mount();
    }
}

/** Runs one overlay command in the page. False when the overlay is not there (the init script did not run in this document). */
export function runOverlay(call: OverlayCall): boolean {
    const api = (globalThis as unknown as OverlayGlobals).__opdkDemo;
    if (api === undefined) {
        return false;
    }
    switch (call.method) {
        case "caption":
            api.caption(call.arg);
            break;
        case "pointer":
            api.pointer(call.arg);
            break;
        case "hidePointer":
            api.hidePointer();
            break;
        case "cursorEnabled":
            api.cursorEnabled(call.arg);
            break;
        case "clean":
            api.clean(call.arg);
            break;
    }
    return true;
}

export interface FreezeResult {
    /** Animations and transitions that were running and were jumped to their end. */
    finished: number;
    /** Endless animations (a caret blink, a spinner) that were paused until `releaseShot()`. */
    paused: number;
}

/**
 * Makes the page hold still for one capture. A CDP screenshot does not wait for anything, so: the class
 * `opdk-shooting` ends CSS transitions at once and hides the caret; running animations jump to their end (an endless
 * one cannot finish, so it is paused and `releaseShot()` plays it again; a finite one that finished stays finished);
 * two frames are awaited so the result is drawn, with a timer as the fallback for a window that draws no frames.
 * `releaseShot()` removes the class.
 */
export async function freezeForShot(): Promise<FreezeResult> {
    const globals = globalThis as unknown as OverlayGlobals;
    const doc = globals.document;
    doc?.documentElement?.classList.add("opdk-shooting");
    const result: FreezeResult = { finished: 0, paused: 0 };
    const paused = (globals.__opdkPaused ??= []);
    for (const animation of doc?.getAnimations?.() ?? []) {
        if (animation.effect?.getComputedTiming().endTime === Infinity) {
            // One the page paused itself stays paused after the shot.
            if (animation.playState === "running") {
                animation.pause();
                paused.push(animation);
                result.paused += 1;
            }
        } else {
            animation.finish();
            result.finished += 1;
        }
    }
    await new Promise<void>((resolve) => {
        let done = false;
        const settle = (): void => {
            if (!done) {
                done = true;
                resolve();
            }
        };
        globals.requestAnimationFrame?.(() => globals.requestAnimationFrame?.(settle));
        globals.setTimeout?.(settle, 100);
    });
    return result;
}

/** Ends the freeze: removes the class and plays the endless animations that `freezeForShot()` paused. */
export function releaseShot(): void {
    const globals = globalThis as unknown as OverlayGlobals;
    globals.document?.documentElement?.classList.remove("opdk-shooting");
    const paused = globals.__opdkPaused ?? [];
    globals.__opdkPaused = [];
    for (const animation of paused) {
        animation.play();
    }
}

/** Whether the focused element takes typed text: a text input, a textarea or a contenteditable (Obsidian's editor is one). */
export function hasEditableFocus(): boolean {
    const element = (globalThis as unknown as OverlayGlobals).document?.activeElement;
    if (element === null || element === undefined) {
        return false;
    }
    if (element.isContentEditable === true || element.tagName === "TEXTAREA") {
        return true;
    }
    const notText = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
    return element.tagName === "INPUT" && !notText.includes(element.type ?? "text");
}

/** The window's size in CSS pixels and its pixel ratio (the emulated one when device metrics are overridden). */
export interface Viewport {
    width: number;
    height: number;
    scale: number;
}

export function readViewport(): Viewport {
    const globals = globalThis as unknown as OverlayGlobals;
    return { width: globals.innerWidth ?? 0, height: globals.innerHeight ?? 0, scale: globals.devicePixelRatio ?? 0 };
}

export function hasViewport(want: Viewport): boolean {
    const globals = globalThis as unknown as OverlayGlobals;
    return globals.innerWidth === want.width && globals.innerHeight === want.height && globals.devicePixelRatio === want.scale;
}

/**
 * The parts of the UI that Obsidian itself can hide. True means shown. The settings are saved at once: Obsidian writes
 * them on a delay, and `reload()` reloads without saving, so a reload right after would bring the old values back
 * (found in the kit's live spec). Returns false when this Obsidian cannot be configured.
 */
export async function applyObsidianUi(show: { showRibbon: boolean; showViewHeader: boolean; showInlineTitle: boolean }): Promise<boolean> {
    const vault = (globalThis as unknown as OverlayGlobals).app?.vault;
    if (vault?.setConfig === undefined) {
        return false;
    }
    for (const [key, value] of Object.entries(show)) {
        vault.setConfig(key, value);
    }
    await vault.saveConfig?.();
    return true;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    applyObsidianUi,
    CURSOR_SVG,
    freezeForShot,
    hasEditableFocus,
    hasViewport,
    installOverlay,
    OVERLAY_CSS,
    readViewport,
    releaseShot,
    runOverlay,
} from "./page-scripts.js";

afterEach(() => {
    vi.unstubAllGlobals();
});

class FakeNode {
    id = "";
    textContent: string | null = null;
    innerHTML = "";
    style = { left: "", top: "", display: "" };
    readonly classes = new Set<string>();
    readonly children: FakeNode[] = [];
    classList = {
        add: (name: string) => this.classes.add(name),
        remove: (name: string) => this.classes.delete(name),
        toggle: (name: string, force: boolean) => (force ? this.classes.add(name) : this.classes.delete(name)),
    };
    append(...nodes: FakeNode[]): void {
        this.children.push(...nodes);
    }
}

interface FakePage {
    root: FakeNode;
    storage: Map<string, string>;
    listeners: Map<string, (event: { clientX: number; clientY: number }) => void>;
    domReady: (() => void)[];
    byId(id: string): FakeNode;
}

/** A document the overlay can mount into. `storage` can be shared between pages to model a reload within one tab. */
function stubPage(options: { readyState?: string; storage?: Map<string, string>; storageThrows?: "set" | "get" } = {}): FakePage {
    const root = new FakeNode();
    const storage = options.storage ?? new Map<string, string>();
    const listeners = new Map<string, (event: { clientX: number; clientY: number }) => void>();
    const domReady: (() => void)[] = [];
    vi.stubGlobal("document", {
        readyState: options.readyState ?? "complete",
        documentElement: root,
        createElement: () => new FakeNode(),
        getElementById: (id: string) => root.children.find((node) => node.id === id) ?? null,
        addEventListener: (_type: string, listener: () => void) => domReady.push(listener),
    });
    vi.stubGlobal("sessionStorage", {
        getItem: (key: string) => {
            if (options.storageThrows === "get") {
                throw new Error("storage refused");
            }
            return storage.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
            if (options.storageThrows === "set") {
                throw new Error("quota");
            }
            storage.set(key, value);
        },
    });
    vi.stubGlobal("addEventListener", (type: string, listener: (event: { clientX: number; clientY: number }) => void) => listeners.set(type, listener));
    vi.stubGlobal("__opdkDemo", undefined);
    return {
        root,
        storage,
        listeners,
        domReady,
        byId: (id) => {
            const node = root.children.find((child) => child.id === id);
            if (node === undefined) {
                throw new Error(`no #${id}`);
            }
            return node;
        },
    };
}

const assets = { cssText: OVERLAY_CSS, cursorSvg: CURSOR_SVG };

function move(page: FakePage, x: number, y: number): void {
    page.listeners.get("mousemove")?.({ clientX: x, clientY: y });
}

describe("installOverlay", () => {
    it("mounts a style, the cursor, the tap dot and the caption bar into <html>, hidden", () => {
        const page = stubPage();
        installOverlay(assets);
        expect(page.root.children.map((node) => node.id)).toEqual(["opdk-overlay-style", "opdk-caption", "opdk-cursor", "opdk-tap"]);
        expect(page.byId("opdk-overlay-style").textContent).toBe(OVERLAY_CSS);
        expect(page.byId("opdk-cursor").innerHTML).toBe(CURSOR_SVG);
        for (const id of ["opdk-cursor", "opdk-tap", "opdk-caption"]) {
            expect(page.byId(id).style.display).toBe("none");
        }
    });

    it("waits for the document while it is still loading, and mounts once", () => {
        const page = stubPage({ readyState: "loading" });
        installOverlay(assets);
        expect(page.root.children).toHaveLength(0);
        page.domReady[0]?.();
        expect(page.root.children).toHaveLength(4);
    });

    it("does nothing a second time in the same document", () => {
        const page = stubPage();
        installOverlay(assets);
        const api = (globalThis as { __opdkDemo?: unknown }).__opdkDemo;
        installOverlay(assets);
        expect(page.root.children).toHaveLength(4);
        expect((globalThis as { __opdkDemo?: unknown }).__opdkDemo).toBe(api);
    });

    it("does nothing in a context without a document", () => {
        vi.stubGlobal("document", undefined);
        vi.stubGlobal("__opdkDemo", undefined);
        expect(() => { installOverlay(assets); }).not.toThrow();
    });

    it("the cursor follows the mouse and shrinks while a button is down", () => {
        const page = stubPage();
        installOverlay(assets);
        move(page, 600, 300);
        const cursor = page.byId("opdk-cursor");
        expect(cursor.style).toMatchObject({ left: "600px", top: "300px", display: "block" });
        expect(page.byId("opdk-tap").style.display).toBe("none");
        page.listeners.get("mousedown")?.({ clientX: 0, clientY: 0 });
        expect(cursor.classes.has("opdk-down")).toBe(true);
        page.listeners.get("mouseup")?.({ clientX: 0, clientY: 0 });
        expect(cursor.classes.has("opdk-down")).toBe(false);
    });

    it("shows the tap dot instead of the cursor for a phone, and it presses too", () => {
        const page = stubPage();
        installOverlay(assets);
        expect(runOverlay({ method: "pointer", arg: "tap" })).toBe(true);
        move(page, 100, 200);
        expect(page.byId("opdk-tap").style).toMatchObject({ left: "100px", top: "200px", display: "block" });
        expect(page.byId("opdk-cursor").style.display).toBe("none");
        page.listeners.get("mousedown")?.({ clientX: 0, clientY: 0 });
        expect(page.byId("opdk-tap").classes.has("opdk-down")).toBe(true);
    });

    it("shows a caption as plain text and removes it with null", () => {
        const page = stubPage();
        installOverlay(assets);
        runOverlay({ method: "caption", arg: "Open <b>the</b> settings & go" });
        const caption = page.byId("opdk-caption");
        expect(caption.textContent).toBe("Open <b>the</b> settings & go");
        expect(caption.innerHTML).toBe("");
        expect(caption.style.display).toBe("block");
        runOverlay({ method: "caption", arg: null });
        expect(caption.style.display).toBe("none");
    });

    it("hides the pointer until the mouse moves again", () => {
        const page = stubPage();
        installOverlay(assets);
        move(page, 5, 6);
        runOverlay({ method: "hidePointer", arg: null });
        expect(page.byId("opdk-cursor").style.display).toBe("none");
        move(page, 7, 8);
        expect(page.byId("opdk-cursor").style.display).toBe("block");
    });

    it("puts the hide classes on <html> for the status bar and the tab headers", () => {
        const page = stubPage();
        installOverlay(assets);
        runOverlay({ method: "clean", arg: { statusBar: true, tabHeaders: false } });
        expect([...page.root.classes]).toEqual(["opdk-hide-status-bar"]);
        runOverlay({ method: "clean", arg: { statusBar: false, tabHeaders: true } });
        expect([...page.root.classes]).toEqual(["opdk-hide-tab-headers"]);
    });

    it("restores its state in the next document of the tab, which is what survives a reload", () => {
        const first = stubPage();
        installOverlay(assets);
        runOverlay({ method: "pointer", arg: "tap" });
        move(first, 40, 50);
        runOverlay({ method: "caption", arg: "Step one" });
        runOverlay({ method: "clean", arg: { statusBar: true, tabHeaders: true } });

        const second = stubPage({ storage: first.storage });
        installOverlay(assets);
        expect(second.byId("opdk-tap").style).toMatchObject({ left: "40px", top: "50px", display: "block" });
        expect(second.byId("opdk-caption").textContent).toBe("Step one");
        expect([...second.root.classes].sort()).toEqual(["opdk-hide-status-bar", "opdk-hide-tab-headers"]);
    });

    it("still works when the storage refuses to be written, and starts empty when it cannot be read", () => {
        const writes = stubPage({ storageThrows: "set" });
        installOverlay(assets);
        runOverlay({ method: "caption", arg: "No storage" });
        expect(writes.byId("opdk-caption").textContent).toBe("No storage");

        const reads = stubPage({ storageThrows: "get" });
        installOverlay(assets);
        expect(reads.byId("opdk-caption").style.display).toBe("none");

        const garbage = stubPage({ storage: new Map([["opdk-demo-state", "{not json"]]) });
        installOverlay(assets);
        expect(garbage.byId("opdk-caption").style.display).toBe("none");
    });
});

describe("runOverlay", () => {
    it("says false when the overlay is not in the document, so the caller can fail", () => {
        vi.stubGlobal("__opdkDemo", undefined);
        expect(runOverlay({ method: "caption", arg: "x" })).toBe(false);
    });
});

describe("the look", () => {
    it("has no transition or animation except `none`, so a capture never catches a state half way", () => {
        for (const match of OVERLAY_CSS.matchAll(/(transition|animation)\s*:\s*([^;}]+)/g)) {
            expect(match[2]?.trim()).toMatch(/^none( !important)?$/);
        }
    });

    it("keeps the overlays above everything and out of the way of the mouse", () => {
        expect(OVERLAY_CSS).toContain("z-index:2147483647");
        expect(OVERLAY_CSS).toContain("pointer-events:none");
    });

    it("puts the cursor and the tap dot above the caption bar, in the style and in the order of the elements", () => {
        const zIndex = (id: string): number => {
            const values = [...OVERLAY_CSS.matchAll(/([^{}\n]+)\{([^}]*)\}/g)]
                .filter((rule) => (rule[1] ?? "").split(",").includes(`#${id}`))
                .flatMap((rule) => [...(rule[2] ?? "").matchAll(/z-index:(\d+)/g)].map((m) => Number(m[1])));
            return values.at(-1) ?? 0;
        };
        expect(zIndex("opdk-cursor")).toBeGreaterThan(zIndex("opdk-caption"));
        expect(zIndex("opdk-tap")).toBeGreaterThan(zIndex("opdk-caption"));
        expect(zIndex("opdk-caption")).toBeGreaterThan(0);
    });

    it("sizes the tap dot 44 px, 36 px when pressed", () => {
        expect(OVERLAY_CSS).toMatch(/#opdk-tap\{width:44px;height:44px/);
        expect(OVERLAY_CSS).toMatch(/#opdk-tap\.opdk-down\{width:36px;height:36px/);
    });

    it("hides the caret and the CodeMirror cursor layer while shooting", () => {
        expect(OVERLAY_CSS).toContain("caret-color:transparent");
        expect(OVERLAY_CSS).toMatch(/html\.opdk-shooting \.cm-cursorLayer\{visibility:hidden/);
    });
});

describe("freezeForShot and releaseShot", () => {
    interface StubAnimation {
        endTime: number;
        playState?: string;
        finish: () => void;
        pause: () => void;
        play: () => void;
    }
    function stubFreeze(animations: StubAnimation[], frames: "frames" | "none" = "frames"): FakeNode {
        const root = new FakeNode();
        vi.stubGlobal("__opdkPaused", undefined);
        vi.stubGlobal("document", {
            documentElement: root,
            getAnimations: () =>
                animations.map((a) => ({ effect: { getComputedTiming: () => ({ endTime: a.endTime }) }, playState: a.playState ?? "running", finish: a.finish, pause: a.pause, play: a.play })),
        });
        if (frames === "frames") {
            vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
                callback();
                return 1;
            });
            vi.stubGlobal("setTimeout", () => 0);
        } else {
            vi.stubGlobal("requestAnimationFrame", undefined);
            vi.stubGlobal("setTimeout", (callback: () => void) => {
                callback();
                return 0;
            });
        }
        return root;
    }

    it("adds the shooting class, finishes finite animations, pauses endless ones, and counts both", async () => {
        const finish = vi.fn();
        const pause = vi.fn();
        const play = vi.fn();
        const root = stubFreeze([
            { endTime: 2000, finish, pause, play },
            { endTime: 300, finish, pause, play },
            { endTime: Infinity, finish, pause, play },
        ]);
        expect(await freezeForShot()).toEqual({ finished: 2, paused: 1 });
        expect(finish).toHaveBeenCalledTimes(2);
        expect(pause).toHaveBeenCalledTimes(1);
        expect(play).not.toHaveBeenCalled();
        expect(root.classes.has("opdk-shooting")).toBe(true);
        releaseShot();
        expect(root.classes.has("opdk-shooting")).toBe(false);
    });

    it("plays the endless animations again on release, once, and not the finished ones", async () => {
        const blink = { endTime: Infinity, finish: vi.fn(), pause: vi.fn(), play: vi.fn() };
        const walk = { endTime: 500, finish: vi.fn(), pause: vi.fn(), play: vi.fn() };
        stubFreeze([blink, walk]);
        await freezeForShot();
        releaseShot();
        expect(blink.play).toHaveBeenCalledTimes(1);
        expect(walk.play).not.toHaveBeenCalled();
        expect(walk.pause).not.toHaveBeenCalled();
        releaseShot();
        expect(blink.play).toHaveBeenCalledTimes(1);
    });

    it("leaves an endless animation the page paused itself alone", async () => {
        const held = { endTime: Infinity, playState: "paused", finish: vi.fn(), pause: vi.fn(), play: vi.fn() };
        stubFreeze([held]);
        expect(await freezeForShot()).toEqual({ finished: 0, paused: 0 });
        releaseShot();
        expect(held.pause).not.toHaveBeenCalled();
        expect(held.play).not.toHaveBeenCalled();
    });

    it("releases cleanly when nothing was frozen, and in a document without animations", () => {
        stubFreeze([]);
        expect(() => { releaseShot(); }).not.toThrow();
    });

    it("falls back to the timer in a window that draws no frames, instead of hanging", async () => {
        stubFreeze([], "none");
        expect(await freezeForShot()).toEqual({ finished: 0, paused: 0 });
    });

    it("lets a failure of an animation surface", async () => {
        stubFreeze([
            {
                endTime: 10,
                finish: () => {
                    throw new Error("InvalidStateError");
                },
                pause: vi.fn(),
                play: vi.fn(),
            },
        ]);
        await expect(freezeForShot()).rejects.toThrow("InvalidStateError");
    });
});

describe("hasEditableFocus", () => {
    const focus = (element: { tagName: string; isContentEditable?: boolean; type?: string } | null | undefined): boolean => {
        vi.stubGlobal("document", { activeElement: element });
        return hasEditableFocus();
    };

    it("is true for a contenteditable, a textarea and a text-like input", () => {
        expect(focus({ tagName: "DIV", isContentEditable: true })).toBe(true);
        expect(focus({ tagName: "TEXTAREA" })).toBe(true);
        expect(focus({ tagName: "INPUT", type: "text" })).toBe(true);
        expect(focus({ tagName: "INPUT", type: "search" })).toBe(true);
        expect(focus({ tagName: "INPUT" })).toBe(true);
    });

    it("is false for the body, a button, a checkbox, nothing at all and a document without focus support", () => {
        expect(focus({ tagName: "BODY", isContentEditable: false })).toBe(false);
        expect(focus({ tagName: "BUTTON" })).toBe(false);
        expect(focus({ tagName: "INPUT", type: "checkbox" })).toBe(false);
        expect(focus({ tagName: "INPUT", type: "submit" })).toBe(false);
        expect(focus(null)).toBe(false);
        expect(focus(undefined)).toBe(false);
        vi.stubGlobal("document", undefined);
        expect(hasEditableFocus()).toBe(false);
    });
});

describe("viewport and Obsidian UI scripts", () => {
    it("reads the window size and ratio and compares them", () => {
        vi.stubGlobal("innerWidth", 390);
        vi.stubGlobal("innerHeight", 844);
        vi.stubGlobal("devicePixelRatio", 2);
        expect(readViewport()).toEqual({ width: 390, height: 844, scale: 2 });
        expect(hasViewport({ width: 390, height: 844, scale: 2 })).toBe(true);
        expect(hasViewport({ width: 390, height: 844, scale: 1 })).toBe(false);
        expect(hasViewport({ width: 391, height: 844, scale: 2 })).toBe(false);
    });

    it("sets the three display settings of Obsidian and saves them before it returns", async () => {
        const calls: string[] = [];
        vi.stubGlobal("app", {
            vault: {
                setConfig: (key: string, value: unknown) => calls.push(`${key}=${String(value)}`),
                saveConfig: () => {
                    calls.push("save");
                    return Promise.resolve();
                },
            },
        });
        expect(await applyObsidianUi({ showRibbon: false, showViewHeader: true, showInlineTitle: false })).toBe(true);
        expect(calls).toEqual(["showRibbon=false", "showViewHeader=true", "showInlineTitle=false", "save"]);
    });

    it("still sets them in an Obsidian that has no saveConfig", async () => {
        const setConfig = vi.fn();
        vi.stubGlobal("app", { vault: { setConfig } });
        expect(await applyObsidianUi({ showRibbon: false, showViewHeader: false, showInlineTitle: false })).toBe(true);
        expect(setConfig).toHaveBeenCalledTimes(3);
    });

    it("says false when this Obsidian has no setConfig", async () => {
        vi.stubGlobal("app", { vault: {} });
        expect(await applyObsidianUi({ showRibbon: false, showViewHeader: false, showInlineTitle: false })).toBe(false);
    });
});

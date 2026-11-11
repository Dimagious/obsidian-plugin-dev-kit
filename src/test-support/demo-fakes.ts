import type { CDPSession, Locator, Page } from "@playwright/test";
import { applyObsidianUi, freezeForShot, hasEditableFocus, hasViewport, installOverlay, readViewport, releaseShot, runOverlay } from "../e2e/demo/page-scripts.js";
import { isMobileApplied } from "../e2e/helpers/page-scripts.js";

/** A PNG that is only a header: enough for the size checks, which read nothing else. */
export function fakePng(width: number, height: number): Buffer {
    const header = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "latin1");
    header.writeUInt32BE(width, 16);
    header.writeUInt32BE(height, 20);
    return header;
}

export interface FakeBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface FakeDemoWindow {
    readonly win: Page;
    readonly cdpSession: CDPSession;
    /** Everything that happened, in order, as short strings. */
    readonly log: string[];
    /** The CDP commands sent, in order. */
    readonly cdp: { method: string; params: unknown }[];
    /** The window as the page reports it; a device metrics override changes it. */
    viewport: { width: number; height: number; scale: number };
    mobile: boolean;
    /** Selectors that have an element on screen, with its box. Others are not visible. */
    readonly visible: Map<string, FakeBox>;
    /** Selectors whose filter({ visible: true }) finds an element. */
    readonly forbiddenVisible: Set<string>;
    /** The density the capture really has, whatever the override says (a display the override does not reach). */
    captureScaleOverride: number | undefined;
    /** Whether an editable element has focus (what `typeSlowly(text)` needs). */
    editableFocus: boolean;
    /** The freeze script fails (an animation that cannot be finished). */
    freezeFails: boolean;
    /** What the overlay page API answers (false: the overlay is missing from the document). */
    overlayPresent: boolean;
    /** The arguments the install scripts were called with, by what ran them (`installOverlay`, `initScript`). */
    readonly calls: Record<string, unknown[]>;
}

/** A stand-in for the Obsidian window as the demo glue uses it. Page functions are told apart by identity, like in `e2e-fakes.ts`. */
export function createFakeDemoWindow(): FakeDemoWindow {
    const log: string[] = [];
    const cdp: { method: string; params: unknown }[] = [];
    const calls: Record<string, unknown[]> = {};
    const record = (key: string, value: unknown): void => {
        (calls[key] ??= []).push(value);
    };
    const fake: FakeDemoWindow = {
        win: undefined as unknown as Page,
        cdpSession: undefined as unknown as CDPSession,
        log,
        cdp,
        viewport: { width: 1200, height: 800, scale: 1 },
        mobile: false,
        visible: new Map(),
        forbiddenVisible: new Set(),
        captureScaleOverride: undefined,
        editableFocus: true,
        freezeFails: false,
        overlayPresent: true,
        calls,
    };
    const session = {
        detach: () => {
            log.push("cdp.detach");
            return Promise.resolve();
        },
        send: (method: string, params?: unknown) => {
            cdp.push({ method, params });
            if (method === "Emulation.setDeviceMetricsOverride") {
                const p = params as { width: number; height: number; deviceScaleFactor: number };
                fake.viewport = { width: p.width, height: p.height, scale: p.deviceScaleFactor };
                return Promise.resolve({});
            }
            if (method === "Page.captureScreenshot") {
                const p = params as { clip?: { width: number; height: number; scale: number } };
                const scale = fake.captureScaleOverride ?? fake.viewport.scale;
                const width = (p.clip?.width ?? fake.viewport.width) * scale;
                const height = (p.clip?.height ?? fake.viewport.height) * scale;
                return Promise.resolve({ data: fakePng(width, height).toString("base64") });
            }
            return Promise.reject(new Error(`fake CDP: unexpected ${method}`));
        },
    };
    const locator = (selector: string): object => {
        const self = {
            waitFor: () => {
                log.push(`waitFor:${selector}`);
                return fake.visible.has(selector) ? Promise.resolve() : Promise.reject(new Error(`Timeout 10000ms exceeded.\nCall log: waiting for ${selector}`));
            },
            boundingBox: () => Promise.resolve(fake.visible.get(selector) ?? null),
            scrollIntoViewIfNeeded: () => {
                log.push(`scroll:${selector}`);
                return Promise.resolve();
            },
            click: () => {
                log.push(`click:${selector}`);
                return Promise.resolve();
            },
            hover: () => {
                log.push(`hover:${selector}`);
                return Promise.resolve();
            },
            pressSequentially: (text: string, options: { delay: number; timeout: number }) => {
                log.push(`pressSequentially:${selector}:${text}:${String(options.delay)}:${String(options.timeout)}`);
                return Promise.resolve();
            },
            filter: (options: { visible: boolean }) => ({
                count: () => {
                    log.push(`count:${selector}:${String(options.visible)}`);
                    return Promise.resolve(fake.forbiddenVisible.has(selector) ? 1 : 0);
                },
            }),
            toString: () => `locator('${selector}')`,
        };
        return self;
    };
    const page = {
        evaluate: (fn: unknown, arg?: unknown) => {
            if (fn === installOverlay) {
                log.push("evaluate:installOverlay");
                record("installOverlay", arg);
                return Promise.resolve(undefined);
            }
            if (fn === runOverlay) {
                log.push(`overlay:${JSON.stringify(arg)}`);
                return Promise.resolve(fake.overlayPresent);
            }
            if (fn === readViewport) {
                return Promise.resolve({ ...fake.viewport });
            }
            if (fn === freezeForShot) {
                log.push("freeze");
                return fake.freezeFails ? Promise.reject(new Error("InvalidStateError")) : Promise.resolve({ finished: 0, paused: 0 });
            }
            if (fn === releaseShot) {
                log.push("release");
                return Promise.resolve(undefined);
            }
            if (fn === hasEditableFocus) {
                return Promise.resolve(fake.editableFocus);
            }
            if (fn === applyObsidianUi) {
                log.push(`ui:${JSON.stringify(arg)}`);
                return Promise.resolve(true);
            }
            if (fn === isMobileApplied) {
                return Promise.resolve(fake.mobile === arg);
            }
            return Promise.reject(new Error("createFakeDemoWindow: page.evaluate was called with a page function the fake does not know. Teach the fake about it."));
        },
        waitForFunction: (fn: unknown, arg: unknown) => {
            if (fn === hasViewport) {
                const want = arg as { width: number; height: number; scale: number };
                const have = fake.viewport;
                return have.width === want.width && have.height === want.height && have.scale === want.scale
                    ? Promise.resolve()
                    : Promise.reject(new Error("Timeout 10000ms exceeded."));
            }
            return Promise.reject(new Error("createFakeDemoWindow: waitForFunction was called with a page function the fake does not know."));
        },
        isClosed: () => false,
        locator: (selector: string) => locator(selector) as Locator,
        mouse: {
            move: (x: number, y: number, options: { steps: number }) => {
                log.push(`mouse.move:${String(x)},${String(y)}:${String(options.steps)}`);
                return Promise.resolve();
            },
            down: () => {
                log.push("mouse.down");
                return Promise.resolve();
            },
            up: () => {
                log.push("mouse.up");
                return Promise.resolve();
            },
        },
        keyboard: {
            type: (text: string, options: { delay: number }) => {
                log.push(`keyboard.type:${text}:${String(options.delay)}`);
                return Promise.resolve();
            },
        },
        waitForTimeout: (ms: number) => {
            log.push(`waitForTimeout:${String(ms)}`);
            return Promise.resolve();
        },
        clock: {
            setFixedTime: (date: Date) => {
                log.push(`setFixedTime:${date.toISOString()}`);
                return Promise.resolve();
            },
        },
        context: () => ({
            newCDPSession: () => {
                log.push("newCDPSession");
                return Promise.resolve(session);
            },
            addInitScript: (fn: unknown, arg: unknown) => {
                log.push(fn === installOverlay ? "initScript:installOverlay" : "initScript:other");
                record("initScript", arg);
                return Promise.resolve();
            },
        }),
    };
    return Object.assign(fake, { win: page as unknown as Page, cdpSession: session as unknown as CDPSession });
}

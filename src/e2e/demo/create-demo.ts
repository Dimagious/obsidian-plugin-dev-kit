import fs from "node:fs";
import path from "node:path";
import type { CDPSession, Locator, Page } from "@playwright/test";
import type { ThemeOptions } from "../helpers/types.js";
import { isMobileApplied } from "../helpers/page-scripts.js";
import { assertPadding, pixelSize, resolveClip, type DemoRect, type Size } from "./clip.js";
import { assertFrameSize } from "./png.js";
import {
    addFrame,
    assertCaptions,
    assertFps,
    assertHold,
    assertKind,
    assertScale,
    frameFileName,
    MANIFEST_FILE,
    MAX_BEAT_SECONDS,
    newManifest,
    resolveCaptionIndex,
    serializeManifest,
    type FilmFrame,
    type FilmManifest,
    type FilmSource,
} from "./manifest.js";
import { resolveName, type ThemeMode } from "./names.js";
import type { ResolvedDemoOptions } from "./options.js";
import { assertFilmFree, assertStillFree, STILLS_DIR, writeFilmOwner, writeStillOwner, type Owner } from "./ownership.js";
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
    type OverlayCall,
    type Viewport,
} from "./page-scripts.js";
import { presetViewport, type PresetViewport } from "./presets.js";
import { assertCaptureAllowed, forbiddenMessage, mergeSelectors, type SeedVaultSource } from "./privacy.js";
import type {
    CleanUiOptions,
    DemoHelpers,
    Film,
    FilmOptions,
    ShotOptions,
    StillOptions,
    StillResult,
    TapOptions,
    TypeSlowlyOptions,
} from "./types.js";

/** Mouse positions between the old and the new place of the cursor, so a viewer can follow it. */
const CURSOR_STEPS = 14;
const DEFAULT_TYPE_DELAY_MS = 40;
/** Per key press, on top of the delay: Playwright's own work for one key. */
const TYPING_SLACK_MS = 50;
const POLL_MS = 50;
const CLEAN_UI_KEYS = ["ribbon", "statusBar", "tabHeaders", "viewHeader", "inlineTitle", "sidebars"];
const FILMS_DIR = "films";

/** What the demo fixture needs from the test: the window, the shared CDP session, and the resolved options. */
export interface DemoDeps {
    readonly win: Page;
    /** The helpers' CDP session. The capture must use this one: Chromium keeps device metrics per session, and a second session drops `mobile()`. */
    readonly cdp: () => Promise<CDPSession>;
    readonly setTheme: (options: ThemeOptions) => Promise<void>;
    /** Folds both side panels and waits until they are folded (`obsidian.collapseSidebars()`). */
    readonly collapseSidebars: () => Promise<void>;
    /** Waits until the page stops changing (`obsidian.settle()`); runs before the freeze of a shot that asks for it. */
    readonly settle: () => Promise<void>;
    readonly options: ResolvedDemoOptions;
    /** How long a target may take to become visible. The session's `timeouts.helpers.ui`. */
    readonly uiTimeoutMs: number;
    readonly seedVault: string;
    readonly seedVaultSource: SeedVaultSource;
    /** The plugin folder (the directory `playwright test` runs in); a seed vault outside it is refused. */
    readonly cwd: string;
    /** The text a film's default name is made of (`defaultNameText`). */
    readonly testTitle: string;
    /** The test that records, written into every manifest. */
    readonly source: FilmSource;
    /** Tells the runs of `playwright test` apart; with the test id it decides whether a name clash is two tests of one run. */
    readonly runId: string;
}

export interface DemoController {
    readonly demo: DemoHelpers;
    /** Marks the films complete when the test's status is `passed`. Anything else (failed, timed out, skipped, interrupted) leaves them incomplete. */
    finish(outcome: { status: string | undefined }): void;
}

interface FilmState {
    manifest: FilmManifest;
    readonly dir: string;
    readonly clip: Locator | DemoRect | undefined;
    readonly padding: number;
    readonly forbidden: readonly string[];
    readonly cursor: boolean;
    kindChecked: boolean;
}

interface CaptureParams {
    readonly what: string;
    readonly scale: number;
    readonly preset: PresetViewport | undefined;
    readonly clip: Locator | DemoRect | undefined;
    readonly padding: number;
    readonly forbidden: readonly string[];
    readonly settle: boolean;
}

function isLocator(target: Locator | DemoRect): target is Locator {
    return "boundingBox" in target;
}

function reason(error: unknown): string {
    return error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error);
}

/** Runs `action`; returns what it threw, or undefined. For cleanup that must not hide the error that made it necessary. */
async function attempt(action: () => Promise<unknown>): Promise<{ error: unknown } | undefined> {
    try {
        await action();
        return undefined;
    } catch (error) {
        return { error };
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function assertSettle(settle: unknown, what: string): boolean {
    if (settle !== undefined && typeof settle !== "boolean") {
        throw new Error(`${what}: settle must be true or false, got ${JSON.stringify(settle)}.`);
    }
    return settle ?? false;
}

function assertClipPadding(clip: unknown, padding: number): void {
    assertPadding(padding);
    if (padding > 0 && clip === undefined) {
        throw new Error("padding is the margin around a clip and needs a clip.");
    }
}

/** The `demo` fixture's functions, bound to one test's window. Everything that waits polls state; the only fixed delay is `beat()`. */
export function createDemo(deps: DemoDeps): DemoController {
    const { win, options } = deps;
    const owner: Owner = { testId: deps.source.testId, runId: deps.runId, title: deps.source.title };
    const films = new Map<string, FilmState>();
    let theme: ThemeMode | null = null;
    let overlayReady: Promise<void> | undefined;
    /** What the page's overlay was last told about the cursor arrow; it is shown until a film asks otherwise. */
    let cursorEnabled = true;

    /** Installs the overlay in every later document (reload, mobile, desktop) and in the one that is up now. */
    function ensureOverlay(): Promise<void> {
        overlayReady ??= (async () => {
            const assets = { cssText: OVERLAY_CSS, cursorSvg: CURSOR_SVG };
            await win.context().addInitScript(installOverlay, assets);
            await win.evaluate(installOverlay, assets);
        })();
        return overlayReady;
    }

    async function overlay(call: OverlayCall): Promise<void> {
        await ensureOverlay();
        if (!(await win.evaluate(runOverlay, call))) {
            throw new Error(`The demo overlay is missing from this document (${call.method}). Its init script runs in every document of the window; was the window replaced?`);
        }
    }

    /** Switches the cursor arrow for the pictures that follow; a call that changes nothing sends nothing. */
    async function setCursor(enabled: boolean): Promise<void> {
        if (enabled !== cursorEnabled) {
            await overlay({ method: "cursorEnabled", arg: enabled });
            cursorEnabled = enabled;
        }
    }

    async function waitVisible(target: Locator, what: string): Promise<void> {
        try {
            await target.waitFor({ state: "visible", timeout: deps.uiTimeoutMs });
        } catch (error) {
            throw new Error(
                `${what}: ${String(target)} was not visible within ${String(deps.uiTimeoutMs)} ms (${reason(error)}). ` +
                    `The demo helpers fail on a missing target instead of skipping it; check the selector and the state of the app.`,
                { cause: error },
            );
        }
    }

    async function targetRect(target: Locator | DemoRect, what: string): Promise<DemoRect> {
        if (!isLocator(target)) {
            return target;
        }
        await waitVisible(target, what);
        const box = await target.boundingBox();
        if (box === null) {
            throw new Error(`${what}: ${String(target)} has no bounding box although it is visible. Is it inside an iframe?`);
        }
        return box;
    }

    /** Sets the window's CSS size and pixel ratio through the shared session; returns what was there, to put it back. */
    async function setViewport(want: { width: number | undefined; height: number | undefined; scale: number }): Promise<Viewport> {
        const before = await win.evaluate(readViewport);
        const target: Viewport = { width: want.width ?? before.width, height: want.height ?? before.height, scale: want.scale };
        if (target.width === before.width && target.height === before.height && target.scale === before.scale) {
            return before;
        }
        const session = await deps.cdp();
        const override = (size: Viewport): Promise<unknown> =>
            session.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: false });
        try {
            await override(target);
            try {
                await win.waitForFunction(hasViewport, target, { polling: POLL_MS, timeout: deps.uiTimeoutMs });
            } catch (error) {
                throw new Error(
                    `The window did not become ${String(target.width)} x ${String(target.height)} at scale ${String(target.scale)} within ${String(deps.uiTimeoutMs)} ms after the device metrics override.`,
                    { cause: error },
                );
            }
        } catch (error) {
            // The window must not stay resized after a failed attempt; the first error is the one to report.
            const restoreFailure = await attempt(() => override(before));
            if (restoreFailure !== undefined) {
                throw new Error(`${errorText(error)} Putting the previous size back also failed (${reason(restoreFailure.error)}); the window may still be resized.`, { cause: error });
            }
            throw error;
        }
        return before;
    }

    async function assertNoForbidden(selectors: readonly string[], what: string): Promise<void> {
        for (const selector of selectors) {
            if ((await win.locator(selector).filter({ visible: true }).count()) > 0) {
                throw new Error(forbiddenMessage(selector, what));
            }
        }
    }

    /** The frozen part of a shot: freeze, find the area, check the forbidden selectors, capture, check the size, thaw. */
    async function captureFrozen(params: CaptureParams): Promise<{ png: Buffer; size: Size }> {
        try {
            // Inside the try: a freeze that fails half way has already set the class, and the release must run.
            await win.evaluate(freezeForShot);
            const viewport = await win.evaluate(readViewport);
            const rect = params.clip === undefined ? undefined : resolveClip(await targetRect(params.clip, params.what), params.padding, viewport, params.what);
            await assertNoForbidden(params.forbidden, params.what);
            const session = await deps.cdp();
            const { data } = await session.send("Page.captureScreenshot", rect === undefined ? { format: "png" } : { format: "png", clip: { ...rect, scale: 1 } });
            const png = Buffer.from(data, "base64");
            return { png, size: assertFrameSize(png, pixelSize(rect ?? viewport, params.scale), params.scale, params.what) };
        } finally {
            await win.evaluate(releaseShot);
        }
    }

    async function capture(params: CaptureParams): Promise<{ png: Buffer; size: Size }> {
        await ensureOverlay();
        const before = await setViewport({ width: params.preset?.cssWidth, height: params.preset?.cssHeight, scale: params.scale });
        let captured: { png: Buffer; size: Size };
        try {
            // After the preset's resize, so the reflow it causes is waited for, and before the freeze, which ends animations.
            if (params.settle) {
                await deps.settle();
            }
            captured = await captureFrozen(params);
        } catch (error) {
            // A preset resizes the window for one picture; put it back, and keep the shot's error when that fails too.
            const restoreFailure = params.preset === undefined ? undefined : await attempt(() => setViewport(before));
            if (restoreFailure !== undefined) {
                throw new Error(`${errorText(error)} Putting the window back also failed: ${errorText(restoreFailure.error)}`, { cause: error });
            }
            throw error;
        }
        // A film keeps its scale from frame to frame.
        if (params.preset !== undefined) {
            await setViewport(before);
        }
        return captured;
    }

    function film(filmOptions: FilmOptions): Film {
        const kind = assertKind(filmOptions.kind);
        const fps = assertFps(filmOptions.fps);
        const scale = assertScale(filmOptions.scale ?? options.scale, "film()");
        const cursor = filmOptions.cursor ?? true;
        if (typeof cursor !== "boolean") {
            throw new Error(`film(): cursor must be true (show the arrow) or false (hide it), got ${JSON.stringify(cursor)}.`);
        }
        const captions = assertCaptions(filmOptions.captions);
        const padding = filmOptions.padding ?? 0;
        assertClipPadding(filmOptions.clip, padding);
        const name = resolveName(filmOptions.name, deps.testTitle, theme, "film");
        assertCaptureAllowed({ source: deps.seedVaultSource, seedVault: deps.seedVault, cwd: deps.cwd, allowForeignVault: filmOptions.allowForeignVault, action: `film "${name}"` });
        if (films.has(name)) {
            throw new Error(`film "${name}" was already started in this test. Pass a name to film() for each film; a retake is a new run of the test, which replaces the frames.`);
        }
        const dir = path.join(options.outDir, FILMS_DIR, name);
        assertFilmFree(dir, owner, `film "${name}"`);
        // A retake replaces the film: frames of an earlier run must not survive next to the new ones.
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        writeFilmOwner(dir, owner);
        const state: FilmState = {
            manifest: newManifest({ name, kind, fps, scale, theme, captions, source: deps.source }),
            dir,
            clip: filmOptions.clip,
            padding,
            forbidden: mergeSelectors(options.forbiddenSelectors, filmOptions.forbiddenSelectors),
            cursor,
            kindChecked: false,
        };
        films.set(name, state);
        const writeManifest = (): void => {
            fs.writeFileSync(path.join(dir, MANIFEST_FILE), serializeManifest(state.manifest));
        };
        writeManifest();
        return {
            name,
            dir,
            shot: async (shotOptions: ShotOptions): Promise<FilmFrame> => {
                const hold = assertHold(shotOptions.hold);
                const caption = resolveCaptionIndex(shotOptions.caption, state.manifest.captions);
                const index = state.manifest.frames.length;
                const what = `film "${name}", frame ${String(index + 1)}`;
                if (!state.kindChecked) {
                    const mobile = await win.evaluate(isMobileApplied, true);
                    if (mobile !== (kind === "phone")) {
                        const fix = mobile
                            ? "Call obsidian.desktop() first, or make this a phone film."
                            : "Call obsidian.mobile() first (and open the note again: the mobile workspace starts empty), or make this a desktop film.";
                        throw new Error(`${what}: the film is a ${kind} film but the window ${mobile ? "is" : "is not"} in the mobile emulation. ${fix}`);
                    }
                    state.kindChecked = true;
                }
                const clip = shotOptions.clip ?? state.clip;
                const padding = shotOptions.padding ?? state.padding;
                assertClipPadding(clip, padding);
                const settle = assertSettle(shotOptions.settle, what);
                await setCursor(state.cursor);
                const { png, size } = await capture({ what, scale, preset: undefined, clip, padding, forbidden: state.forbidden, settle });
                const frame: FilmFrame = { file: frameFileName(index), hold, caption };
                // Checks the size against the first frame before anything is written.
                const next = addFrame(state.manifest, frame, size);
                fs.writeFileSync(path.join(dir, frame.file), png);
                state.manifest = next;
                writeManifest();
                return frame;
            },
        };
    }

    async function still(name: string, stillOptions: StillOptions = {}): Promise<StillResult> {
        const fileName = resolveName(name, deps.testTitle, theme, "still");
        assertCaptureAllowed({ source: deps.seedVaultSource, seedVault: deps.seedVault, cwd: deps.cwd, allowForeignVault: stillOptions.allowForeignVault, action: `still "${fileName}"` });
        const stillsDir = path.join(options.outDir, STILLS_DIR);
        assertStillFree(options.outDir, fileName, owner, `still "${fileName}"`);
        const preset = stillOptions.preset === undefined ? undefined : presetViewport(stillOptions.preset);
        if (preset !== undefined && (stillOptions.clip !== undefined || stillOptions.scale !== undefined)) {
            throw new Error(`still "${fileName}": the preset ${String(stillOptions.preset)} fixes the picture size, so it cannot be combined with clip or scale.`);
        }
        const padding = stillOptions.padding ?? 0;
        assertClipPadding(stillOptions.clip, padding);
        const scale = preset?.scale ?? assertScale(stillOptions.scale ?? options.scale, `still "${fileName}"`);
        const settle = assertSettle(stillOptions.settle, `still "${fileName}"`);
        await setCursor(true);
        const { png, size } = await capture({
            what: `still "${fileName}"`,
            scale,
            preset,
            clip: stillOptions.clip,
            padding,
            forbidden: mergeSelectors(options.forbiddenSelectors, stillOptions.forbiddenSelectors),
            settle,
        });
        fs.mkdirSync(stillsDir, { recursive: true });
        const file = path.join(stillsDir, `${fileName}.png`);
        fs.writeFileSync(file, png);
        writeStillOwner(options.outDir, fileName, owner);
        return { file, width: size.width, height: size.height };
    }

    async function moveAndClick(target: Locator): Promise<void> {
        await overlay({ method: "pointer", arg: "cursor" });
        await waitVisible(target, "moveAndClick()");
        await target.scrollIntoViewIfNeeded({ timeout: deps.uiTimeoutMs });
        const box = await target.boundingBox();
        if (box === null) {
            throw new Error(`moveAndClick(): ${String(target)} has no bounding box although it is visible.`);
        }
        await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: CURSOR_STEPS });
        await target.click({ timeout: deps.uiTimeoutMs });
    }

    async function tap(target: Locator, tapOptions: TapOptions = {}): Promise<void> {
        await overlay({ method: "pointer", arg: "tap" });
        await waitVisible(target, "tap()");
        // hover() scrolls, checks that the target is not covered, and moves the mouse to its centre.
        await target.hover({ timeout: deps.uiTimeoutMs });
        await win.mouse.down();
        try {
            await tapOptions.whilePressed?.();
        } finally {
            // The finger goes up and the dot goes away even when the callback failed: a dot left behind shows in the next frame.
            try {
                await win.mouse.up();
            } finally {
                await overlay({ method: "hidePointer", arg: null });
            }
        }
    }

    async function typeSlowly(first: Locator | string, second?: string | TypeSlowlyOptions, third?: TypeSlowlyOptions): Promise<void> {
        const target = typeof first === "string" ? undefined : first;
        const text = typeof first === "string" ? first : second;
        const typeOptions = typeof first === "string" ? second : third;
        if (typeof text !== "string" || (typeOptions !== undefined && typeof typeOptions === "string")) {
            throw new Error("typeSlowly(): pass the text, or a target and the text.");
        }
        const delay = typeOptions?.delayMs ?? DEFAULT_TYPE_DELAY_MS;
        if (!Number.isFinite(delay) || delay < 0) {
            throw new Error(`typeSlowly(): delayMs must be a number of milliseconds from 0, got ${String(delay)}.`);
        }
        if (target === undefined) {
            if (!(await win.evaluate(hasEditableFocus))) {
                throw new Error("typeSlowly(text): nothing editable has focus, so the keys would go nowhere. Pass the target, typeSlowly(locator, text), or focus an input or the editor first.");
            }
            await win.keyboard.type(text, { delay });
            return;
        }
        await moveAndClick(target);
        await target.pressSequentially(text, { delay, timeout: deps.uiTimeoutMs + text.length * (delay + TYPING_SLACK_MS) });
    }

    async function beat(seconds: number): Promise<void> {
        if (!Number.isFinite(seconds) || seconds < 0) {
            throw new Error(`beat(): seconds must be a number from 0, got ${String(seconds)}.`);
        }
        if (seconds > MAX_BEAT_SECONDS) {
            throw new Error(
                `beat(): ${String(seconds)} seconds is more than ${String(MAX_BEAT_SECONDS)}. beat() takes seconds, not milliseconds (Snipsy's beat took milliseconds); ` +
                    `did you mean beat(${String(seconds / 1000)})?`,
            );
        }
        await win.waitForTimeout(seconds * 1000);
    }

    async function cleanUi(cleanOptions: CleanUiOptions = {}): Promise<void> {
        for (const key of Object.keys(cleanOptions)) {
            if (!CLEAN_UI_KEYS.includes(key)) {
                throw new Error(`cleanUi(): unknown option "${key}". Known options: ${CLEAN_UI_KEYS.join(", ")}.`);
            }
        }
        const hide = {
            ribbon: cleanOptions.ribbon ?? true,
            statusBar: cleanOptions.statusBar ?? true,
            tabHeaders: cleanOptions.tabHeaders ?? true,
            viewHeader: cleanOptions.viewHeader ?? true,
            inlineTitle: cleanOptions.inlineTitle ?? true,
        };
        const sidebars = cleanOptions.sidebars ?? true;
        for (const [key, value] of Object.entries({ ...hide, sidebars })) {
            if (typeof value !== "boolean") {
                throw new Error(`cleanUi(): ${key} must be true (hide) or false (show), got ${JSON.stringify(value)}.`);
            }
        }
        await ensureOverlay();
        const applied = await win.evaluate(applyObsidianUi, { showRibbon: !hide.ribbon, showViewHeader: !hide.viewHeader, showInlineTitle: !hide.inlineTitle });
        if (!applied) {
            throw new Error("cleanUi(): this Obsidian has no app.vault.setConfig. The helper was verified on Obsidian 1.14.5.");
        }
        await overlay({ method: "clean", arg: { statusBar: hide.statusBar, tabHeaders: hide.tabHeaders } });
        if (sidebars) {
            await deps.collapseSidebars();
        }
    }

    async function freezeTime(date: Date | string | number): Promise<void> {
        const at = new Date(date);
        if (Number.isNaN(at.getTime())) {
            throw new Error(`freezeTime(): ${String(date)} is not a date. Pass a Date, an ISO string such as "2026-03-14T09:26:00", or a timestamp.`);
        }
        // setFixedTime, not clock.install: an installed clock that is paused stops every timer in Obsidian.
        await win.clock.setFixedTime(at);
    }

    async function themes(modes: readonly ThemeMode[], scene: (mode: ThemeMode) => Promise<void>): Promise<void> {
        if (theme !== null) {
            throw new Error(`themes() cannot be nested: the scene of the ${theme} run called it again.`);
        }
        // A spec in plain JavaScript can pass anything.
        const given: readonly string[] = modes;
        if (given.length === 0 || new Set(given).size !== given.length || given.some((mode) => mode !== "light" && mode !== "dark")) {
            throw new Error(`themes(): pass "light", "dark" or both, each once; got ${JSON.stringify(modes)}.`);
        }
        for (const mode of modes) {
            await deps.setTheme({ mode });
            theme = mode;
            try {
                await scene(mode);
            } finally {
                theme = null;
            }
        }
    }

    const demo: DemoHelpers = {
        film,
        still,
        moveAndClick,
        tap,
        typeSlowly,
        beat,
        caption: (text) => overlay({ method: "caption", arg: text }),
        hideCursor: () => overlay({ method: "hidePointer", arg: null }),
        cleanUi,
        freezeTime,
        themes,
    };
    return {
        demo,
        finish: ({ status }) => {
            // A test marked test.fail() "fails as expected" and stays unfinished too: only a real pass completes a film.
            if (status !== "passed") {
                return;
            }
            for (const state of films.values()) {
                if (state.manifest.frames.length > 0) {
                    state.manifest = { ...state.manifest, complete: true };
                    fs.writeFileSync(path.join(state.dir, MANIFEST_FILE), serializeManifest(state.manifest));
                }
            }
        },
    };
}

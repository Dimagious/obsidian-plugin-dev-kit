import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { FilmFrame } from "../e2e/demo/manifest.js";
import { assertElectronInstalled, createElectronProbe } from "../e2e/electron-binary.js";
import { readPngSize } from "../e2e/demo/png.js";
import { buildPhonePage, captionSteps, PAGE_HEIGHT, PAGE_SCALE, PAGE_WIDTH, type PhoneLayout } from "./phone-layout.js";

/**
 * The whole Electron side of the phone layout: a window that never shows, an empty page. Playwright drives it, so
 * nothing here knows about frames. `OPDK_COMPOSE_USERDATA` keeps Electron's profile out of the user's home.
 */
const MAIN_SCRIPT = `const { app, BrowserWindow } = require("electron");
if (process.env.OPDK_COMPOSE_USERDATA) app.setPath("userData", process.env.OPDK_COMPOSE_USERDATA);
if (app.dock) app.dock.hide();
app.whenReady().then(() => {
    const win = new BrowserWindow({ width: ${String(PAGE_WIDTH)}, height: ${String(PAGE_HEIGHT)}, show: false, useContentSize: true, webPreferences: { backgroundThrottling: false } });
    void win.loadURL("about:blank");
});
`;

const LAUNCH_TIMEOUT_MS = 60_000;
/** One page operation (loading a picture, taking a screenshot) takes milliseconds; this much means the window hung. */
const STEP_TIMEOUT_MS = 30_000;

/**
 * Set to `1` to start Electron with `--no-sandbox`. Needed where Chromium's sandbox cannot start, which is the
 * case on GitHub's Ubuntu runners (no SUID helper, user namespaces restricted); the kit's own CI sets it. Do not
 * set it on a machine where the plugin's Electron starts without it.
 */
export const NO_SANDBOX_ENV = "OPDK_COMPOSE_NO_SANDBOX";

/** Rejects with `what` when `work` has not settled in `ms`; the timer is always cleared. */
export async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${what} did not finish in ${String(ms / 1000)} s; the Electron window is stuck.`));
        }, ms);
    });
    try {
        return await Promise.race([work, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

export interface ComposeParams {
    /** The plugin root: `electron` and nothing else is resolved from it. */
    readonly cwd: string;
    /** Folder of the film's frames. */
    readonly filmDir: string;
    readonly frames: readonly FilmFrame[];
    readonly captions: readonly string[];
    readonly layout: PhoneLayout;
    /** Receives one `<frame file>` per input frame, 2000 x 1240 px. */
    readonly outDir: string;
    /** Where the render keeps its profile and script while it runs; removed at the end. Default: the OS temp folder. */
    readonly tmpDir?: string;
}

/** Composes every frame into the caption page. Throws with what to do when Electron or Playwright is missing. */
export async function composePhoneFrames(params: ComposeParams): Promise<void> {
    const executablePath = resolveElectron(params.cwd);
    const { _electron } = await loadPlaywright();
    const workDir = fs.mkdtempSync(path.join(params.tmpDir ?? os.tmpdir(), "opdk-demo-electron-"));
    const mainFile = path.join(workDir, "main.cjs");
    fs.writeFileSync(mainFile, MAIN_SCRIPT);
    const env: Record<string, string> = { OPDK_COMPOSE_USERDATA: path.join(workDir, "profile") };
    const args = process.env[NO_SANDBOX_ENV] === "1" ? ["--no-sandbox", mainFile] : [mainFile];
    for (const [key, value] of Object.entries(process.env)) {
        // Set, Electron would run as plain Node and have no `app`.
        if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") {
            env[key] = value;
        }
    }
    try {
        const app = await _electron.launch({ executablePath, args, env, timeout: LAUNCH_TIMEOUT_MS });
        try {
            const win = await withTimeout(app.firstWindow(), LAUNCH_TIMEOUT_MS, "Opening the Electron window");
            const cdp = await win.context().newCDPSession(win);
            await withTimeout(
                cdp.send("Emulation.setDeviceMetricsOverride", { width: PAGE_WIDTH, height: PAGE_HEIGHT, deviceScaleFactor: PAGE_SCALE, mobile: false }),
                STEP_TIMEOUT_MS,
                "Setting the page scale",
            );
            const steps = captionSteps(params.frames);
            fs.mkdirSync(params.outDir, { recursive: true });
            for (const [index, frame] of params.frames.entries()) {
                const image = fs.readFileSync(path.join(params.filmDir, frame.file)).toString("base64");
                const step = steps[index] ?? null;
                await win.setContent(buildPhonePage({ imageDataUrl: `data:image/png;base64,${image}`, captions: params.captions, step, layout: params.layout }), {
                    timeout: STEP_TIMEOUT_MS,
                });
                await withTimeout(
                    win.evaluate("Promise.all([...document.images].map((image) => image.decode())).then(() => document.fonts.ready).then(() => undefined)"),
                    STEP_TIMEOUT_MS,
                    `Loading ${frame.file}`,
                );
                const shot = await withTimeout(cdp.send("Page.captureScreenshot", { format: "png" }), STEP_TIMEOUT_MS, `Taking the screenshot of ${frame.file}`);
                const png = Buffer.from(shot.data, "base64");
                const size = readPngSize(png);
                if (size.width !== PAGE_WIDTH * PAGE_SCALE || size.height !== PAGE_HEIGHT * PAGE_SCALE) {
                    throw new Error(
                        `the composed frame ${frame.file} is ${String(size.width)} x ${String(size.height)} px, expected ${String(PAGE_WIDTH * PAGE_SCALE)} x ${String(PAGE_HEIGHT * PAGE_SCALE)}. ` +
                            `Electron did not apply the 2x device scale.`,
                    );
                }
                fs.writeFileSync(path.join(params.outDir, frame.file), png);
            }
        } finally {
            await app.close();
        }
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

/** The binary of the plugin's own `electron` devDependency, the one its e2e tests run on. */
function resolveElectron(cwd: string): string {
    try {
        assertElectronInstalled(cwd, createElectronProbe());
    } catch (error) {
        throw new Error(
            `layout "phone-captions" renders its frames in Electron, from the plugin's own "electron" devDependency. ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
    const resolved: unknown = createRequire(path.join(cwd, "noop.js"))("electron");
    if (typeof resolved !== "string") {
        throw new Error(`The "electron" package in ${cwd} did not export the path of its binary. Reinstall it: npm install --save-dev electron.`);
    }
    return resolved;
}

async function loadPlaywright(): Promise<{ _electron: typeof import("@playwright/test")._electron }> {
    try {
        const { _electron } = await import("@playwright/test");
        return { _electron };
    } catch (error) {
        throw new Error(
            `layout "phone-captions" drives Electron through Playwright, and "@playwright/test" cannot be loaded: ${error instanceof Error ? error.message : String(error)}. ` +
                `Install it: npm install --save-dev @playwright/test.`,
            { cause: error },
        );
    }
}

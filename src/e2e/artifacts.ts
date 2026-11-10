/**
 * Trace and video for the Obsidian window. Playwright's `use.trace` and `use.video` only apply to the browser
 * contexts its own fixtures create; the window of an `_electron` launch is outside them, so the kit reads the same
 * settings and does what Playwright does for a browser: decide per attempt whether to record, and whether to keep.
 */

export type ArtifactMode =
    | "off"
    | "on"
    | "retain-on-failure"
    | "on-first-retry"
    | "on-all-retries"
    | "retain-on-first-failure"
    | "retain-on-failure-and-retries";

const MODES: readonly ArtifactMode[] = [
    "off",
    "on",
    "retain-on-failure",
    "on-first-retry",
    "on-all-retries",
    "retain-on-first-failure",
    "retain-on-failure-and-retries",
];

export interface TraceSettings {
    readonly mode: ArtifactMode;
    readonly screenshots: boolean;
    readonly snapshots: boolean;
    readonly sources: boolean;
}

export interface VideoSettings {
    readonly mode: ArtifactMode;
    readonly size?: { readonly width: number; readonly height: number };
}

/** Does this attempt record? `retry` is 0 for the first run, 1 for the first retry. */
export function shouldRecord(mode: ArtifactMode, retry: number): boolean {
    switch (mode) {
        case "off":
            return false;
        case "on":
        case "retain-on-failure":
        case "retain-on-failure-and-retries":
            return true;
        case "retain-on-first-failure":
            return retry === 0;
        case "on-first-retry":
            return retry === 1;
        case "on-all-retries":
            return retry > 0;
    }
}

/** Is a recording of this attempt kept? Only meaningful when `shouldRecord` is true; otherwise nothing exists to keep. */
export function shouldKeep(mode: ArtifactMode, failed: boolean, retry: number): boolean {
    if (!shouldRecord(mode, retry)) {
        return false;
    }
    switch (mode) {
        case "retain-on-failure":
        case "retain-on-first-failure":
            return failed;
        case "retain-on-failure-and-retries":
            return failed || retry > 0;
        default:
            return true;
    }
}

/** Playwright's deprecated aliases of `on-first-retry`: each one is valid for its own option only. */
const DEPRECATED_ALIASES: Readonly<Record<string, string>> = {
    "use.trace": "retry-with-trace",
    "use.trace.mode": "retry-with-trace",
    "use.video": "retry-with-video",
    "use.video.mode": "retry-with-video",
};

function parseMode(value: unknown, option: string): ArtifactMode {
    if (value !== undefined && value === DEPRECATED_ALIASES[option]) {
        return "on-first-retry";
    }
    const mode = MODES.find((candidate) => candidate === value);
    if (mode === undefined) {
        throw new Error(
            `Unsupported ${option} value ${JSON.stringify(value)} in the Playwright config. Use one of: ${MODES.join(", ")}.`,
        );
    }
    return mode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/** Reads `use.trace`: a mode string or `{ mode, screenshots, snapshots, sources }`. Unset means `off`. */
export function parseTraceSetting(value: unknown): TraceSettings {
    const mode = isRecord(value) ? parseMode(value.mode, "use.trace.mode") : parseMode(value ?? "off", "use.trace");
    const flags = isRecord(value) ? value : {};
    // `snapshots` can also be an object of per-kind switches in newer Playwright; any object means "on".
    return {
        mode,
        screenshots: flags.screenshots !== false,
        snapshots: flags.snapshots !== false,
        sources: flags.sources !== false,
    };
}

/** Reads `use.video`: a mode string or `{ mode, size }`. Unset means `off`. */
export function parseVideoSetting(value: unknown): VideoSettings {
    if (!isRecord(value)) {
        return { mode: parseMode(value ?? "off", "use.video") };
    }
    const mode = parseMode(value.mode, "use.video.mode");
    const { size } = value;
    if (isRecord(size) && typeof size.width === "number" && typeof size.height === "number") {
        return { mode, size: { width: size.width, height: size.height } };
    }
    return { mode };
}

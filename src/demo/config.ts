import type {
    DemoBudgetConfig,
    DemoConfig,
    DemoFilmConfig,
    DemoGifConfig,
    DemoLayout,
    DemoLoopMode,
    DemoPhoneColors,
    DemoPhoneConfig,
    DemoPosterConfig,
    DemoStillsConfig,
} from "../config/types.js";
import { DEFAULT_DEMO_OUT_DIR } from "../e2e/demo/options.js";

export const DEFAULT_OUTPUT_DIR = "docs/screens";
/** GitHub shows a README at about 1000 px; a wider GIF is scaled down by the browser and only costs bytes. */
export const MAX_AUTO_GIF_WIDTH = 1000;
export const DEFAULT_GIF_COLORS = 128;
export const DEFAULT_GIF_FPS = 10;
export const DEFAULT_WARN_BYTES = 2 * 1024 * 1024;
/** GitHub's limit for an image or GIF attached to an issue or pull request. */
export const DEFAULT_FAIL_BYTES = 10 * 1024 * 1024;

const LAYOUTS: readonly DemoLayout[] = ["plain", "phone-captions"];
const LOOP_MODES: readonly DemoLoopMode[] = ["warn", "fail", "off"];
const FILM_KEYS = ["gif", "mp4", "poster", "layout", "budget", "loop", "phone"];
const DEMO_KEYS = [...FILM_KEYS, "outDir", "output", "stills", "films"];
const GIF_KEYS = ["width", "colors", "fps"];
const POSTER_KEYS = ["width"];
const STILLS_KEYS = ["output"];
const BUDGET_KEYS = ["warnBytes", "failBytes"];
const COLOR_KEYS = ["background", "text", "muted", "accent"] as const;
const PHONE_KEYS = [...COLOR_KEYS, "font", "title", "light", "dark"];

/** Checks and copies the `demo` section of `opdk.config.mjs`. Every error names the offending key. */
export function validateDemoConfig(value: unknown, source: string): DemoConfig {
    if (!isRecord(value)) {
        throw new Error(`${source}: "demo" must be an object.`);
    }
    rejectUnknownKeys(value, DEMO_KEYS, "demo", source);
    const outDir = optionalString(value, "outDir", "demo.outDir", source);
    const output = optionalString(value, "output", "demo.output", source);
    const stills = optionalStills(value, source);
    const films = optionalFilms(value, source);
    return {
        ...validateFilmConfig(value, "demo", source),
        ...(outDir !== undefined && { outDir }),
        ...(output !== undefined && { output }),
        ...(stills !== undefined && { stills }),
        ...(films !== undefined && { films }),
    };
}

function validateFilmConfig(value: Record<string, unknown>, label: string, source: string): DemoFilmConfig {
    const gif = optionalGif(value, label, source);
    const mp4 = optionalBoolean(value, "mp4", `${label}.mp4`, source);
    const poster = optionalPoster(value, label, source);
    const layout = optionalOneOf(value, "layout", `${label}.layout`, LAYOUTS, source);
    const budget = optionalBudget(value, label, source);
    const loop = optionalOneOf(value, "loop", `${label}.loop`, LOOP_MODES, source);
    const phone = optionalPhone(value, label, source);
    return {
        ...(gif !== undefined && { gif }),
        ...(mp4 !== undefined && { mp4 }),
        ...(poster !== undefined && { poster }),
        ...(layout !== undefined && { layout }),
        ...(budget !== undefined && { budget }),
        ...(loop !== undefined && { loop }),
        ...(phone !== undefined && { phone }),
    };
}

function optionalPoster(parent: Record<string, unknown>, label: string, source: string): DemoPosterConfig | boolean | undefined {
    const value = own(parent, "poster");
    if (value === undefined || typeof value === "boolean") {
        return value;
    }
    if (!isRecord(value)) {
        throw new Error(`${source}: "${label}.poster" must be an object ({ width }) or true or false.`);
    }
    rejectUnknownKeys(value, POSTER_KEYS, `${label}.poster`, source);
    const width = optionalInteger(value, "width", `${label}.poster.width`, 16, 8000, source);
    return width === undefined ? {} : { width };
}

function optionalStills(parent: Record<string, unknown>, source: string): DemoStillsConfig | boolean | undefined {
    const value = own(parent, "stills");
    if (value === undefined || typeof value === "boolean") {
        return value;
    }
    if (!isRecord(value)) {
        throw new Error(`${source}: "demo.stills" must be an object ({ output }) or true or false.`);
    }
    rejectUnknownKeys(value, STILLS_KEYS, "demo.stills", source);
    const output = optionalString(value, "output", "demo.stills.output", source);
    return output === undefined ? {} : { output };
}

function optionalGif(parent: Record<string, unknown>, label: string, source: string): DemoGifConfig | false | undefined {
    const value = own(parent, "gif");
    if (value === undefined || value === false) {
        return value;
    }
    if (!isRecord(value)) {
        throw new Error(`${source}: "${label}.gif" must be an object ({ width, colors, fps }) or false.`);
    }
    rejectUnknownKeys(value, GIF_KEYS, `${label}.gif`, source);
    const width = optionalInteger(value, "width", `${label}.gif.width`, 16, 8000, source);
    const colors = optionalInteger(value, "colors", `${label}.gif.colors`, 2, 256, source);
    const fps = optionalInteger(value, "fps", `${label}.gif.fps`, 1, 50, source);
    return {
        ...(width !== undefined && { width }),
        ...(colors !== undefined && { colors }),
        ...(fps !== undefined && { fps }),
    };
}

function optionalBudget(parent: Record<string, unknown>, label: string, source: string): DemoBudgetConfig | undefined {
    const value = own(parent, "budget");
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        throw new Error(`${source}: "${label}.budget" must be an object ({ warnBytes, failBytes }).`);
    }
    rejectUnknownKeys(value, BUDGET_KEYS, `${label}.budget`, source);
    const warnBytes = optionalInteger(value, "warnBytes", `${label}.budget.warnBytes`, 1, Number.MAX_SAFE_INTEGER, source);
    const failBytes = optionalInteger(value, "failBytes", `${label}.budget.failBytes`, 1, Number.MAX_SAFE_INTEGER, source);
    if (warnBytes !== undefined && failBytes !== undefined && warnBytes > failBytes) {
        throw new Error(`${source}: "${label}.budget.warnBytes" (${String(warnBytes)}) must not be above "failBytes" (${String(failBytes)}).`);
    }
    return { ...(warnBytes !== undefined && { warnBytes }), ...(failBytes !== undefined && { failBytes }) };
}

function optionalPhone(parent: Record<string, unknown>, label: string, source: string): DemoPhoneConfig | undefined {
    const value = own(parent, "phone");
    if (value === undefined) {
        return undefined;
    }
    const where = `${label}.phone`;
    if (!isRecord(value)) {
        throw new Error(`${source}: "${where}" must be an object ({ background, text, muted, accent, font, title, light, dark }).`);
    }
    rejectUnknownKeys(value, PHONE_KEYS, where, source);
    const light = optionalPhoneColors(value, "light", where, source);
    const dark = optionalPhoneColors(value, "dark", where, source);
    const font = optionalString(value, "font", `${where}.font`, source);
    const title = optionalString(value, "title", `${where}.title`, source);
    return {
        ...readPhoneColors(value, where, source),
        ...(light !== undefined && { light }),
        ...(dark !== undefined && { dark }),
        ...(font !== undefined && { font: assertCssValue(font, `${source}: "${where}.font"`, "font") }),
        ...(title !== undefined && { title }),
    };
}

function optionalPhoneColors(parent: Record<string, unknown>, key: "light" | "dark", where: string, source: string): DemoPhoneColors | undefined {
    const value = own(parent, key);
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        throw new Error(`${source}: "${where}.${key}" must be an object ({ background, text, muted, accent }).`);
    }
    rejectUnknownKeys(value, COLOR_KEYS, `${where}.${key}`, source);
    return readPhoneColors(value, `${where}.${key}`, source);
}

function readPhoneColors(record: Record<string, unknown>, where: string, source: string): DemoPhoneColors {
    const colors: { -readonly [K in keyof DemoPhoneColors]: DemoPhoneColors[K] } = {};
    for (const key of COLOR_KEYS) {
        const text = optionalString(record, key, `${where}.${key}`, source);
        if (text !== undefined) {
            colors[key] = assertCssValue(text, `${source}: "${where}.${key}"`, "color");
        }
    }
    return colors;
}

function optionalFilms(parent: Record<string, unknown>, source: string): Record<string, DemoFilmConfig> | undefined {
    const value = own(parent, "films");
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        throw new Error(`${source}: "demo.films" must be an object keyed by film name.`);
    }
    const films: Record<string, DemoFilmConfig> = {};
    for (const [name, film] of Object.entries(value)) {
        const label = `demo.films[${JSON.stringify(name)}]`;
        if (!isRecord(film)) {
            throw new Error(`${source}: "${label}" must be an object.`);
        }
        rejectUnknownKeys(film, FILM_KEYS, label, source);
        films[name] = validateFilmConfig(film, label, source);
    }
    return films;
}

/**
 * A colour or font goes into a `<style>` rule of the page the phone layout renders. A value that could end the
 * declaration, the rule or the element (`; { } < >`), start an escape (`\`), a comment (`/*`) or a request (`url(`)
 * is a mistake (or worse), never something to quietly strip. Quotes are refused in a colour; a font list needs them
 * around family names with spaces, so there they only have to come in pairs.
 */
export function assertCssValue(value: string, what: string, kind: "color" | "font" = "color"): string {
    const forbidden = /[;{}<>\\]|\/\*|url\(/i.exec(value);
    if (forbidden !== null) {
        throw new Error(`${what} must be a CSS value without ${JSON.stringify(forbidden[0])}, got ${JSON.stringify(value)}.`);
    }
    const quotes = (char: string): number => value.split(char).length - 1;
    if (kind === "color" ? /["']/.test(value) : quotes('"') % 2 !== 0 || quotes("'") % 2 !== 0) {
        throw new Error(
            `${what} must be a CSS value ${kind === "color" ? "without quotes" : "with quotes in pairs"}, got ${JSON.stringify(value)}.`,
        );
    }
    return value;
}

/** Everything a film needs to be encoded, after defaults and overrides are merged. */
export interface FilmSettings {
    /** Null when the GIF is off. A null width means "from the frames". */
    readonly gif: { readonly width: number | null; readonly colors: number; readonly fps: number | null } | null;
    readonly mp4: boolean;
    /** Null when the poster is off. A null width means "the width of the frames". */
    readonly poster: { readonly width: number | null } | null;
    readonly layout: DemoLayout;
    readonly budget: { readonly warnBytes: number; readonly failBytes: number };
    readonly loop: DemoLoopMode;
    /** The `phone` entries that apply, weakest first: the top level of `demo`, then the base name, then the exact name. */
    readonly phone: readonly DemoPhoneConfig[];
}

/** The name an override for a theme pair is filed under: `tour-dark` of a dark film reads the entry `tour`. */
export function baseFilmName(name: string, theme: "light" | "dark" | null): string {
    return theme !== null && name.endsWith(`-${theme}`) ? name.slice(0, -theme.length - 1) : name;
}

/** Defaults, then the top level of `demo`, then `demo.films[<base name>]`, then `demo.films[<name>]`. */
export function resolveFilmSettings(config: DemoConfig, name: string, theme: "light" | "dark" | null, source: string): FilmSettings {
    const layers: DemoFilmConfig[] = [config];
    const overrides = config.films ?? {};
    const base = baseFilmName(name, theme);
    for (const key of base === name ? [name] : [base, name]) {
        const override = Object.hasOwn(overrides, key) ? overrides[key] : undefined;
        if (override !== undefined) {
            layers.push(override);
        }
    }
    let gif: FilmSettings["gif"] = { width: null, colors: DEFAULT_GIF_COLORS, fps: null };
    let mp4 = true;
    let poster: FilmSettings["poster"] = { width: null };
    let layout: DemoLayout = "plain";
    let loop: DemoLoopMode = "warn";
    const phone: DemoPhoneConfig[] = [];
    let warnBytes = DEFAULT_WARN_BYTES;
    let failBytes = DEFAULT_FAIL_BYTES;
    for (const layer of layers) {
        if (layer.gif === false) {
            gif = null;
        } else if (layer.gif !== undefined) {
            gif = {
                width: layer.gif.width ?? gif?.width ?? null,
                colors: layer.gif.colors ?? gif?.colors ?? DEFAULT_GIF_COLORS,
                fps: layer.gif.fps ?? gif?.fps ?? null,
            };
        }
        mp4 = layer.mp4 ?? mp4;
        if (layer.poster === false) {
            poster = null;
        } else if (layer.poster !== undefined) {
            poster = { width: (layer.poster === true ? undefined : layer.poster.width) ?? poster?.width ?? null };
        }
        layout = layer.layout ?? layout;
        loop = layer.loop ?? loop;
        if (layer.phone !== undefined) {
            phone.push(layer.phone);
        }
        warnBytes = layer.budget?.warnBytes ?? warnBytes;
        failBytes = layer.budget?.failBytes ?? failBytes;
    }
    if (warnBytes > failBytes) {
        throw new Error(
            `${source}: the byte budget of film "${name}" has warnBytes (${String(warnBytes)}) above failBytes (${String(failBytes)}). ` +
                `Set both in the same "budget" object.`,
        );
    }
    return { gif, mp4, poster, layout, budget: { warnBytes, failBytes }, loop, phone };
}

/** The two folders of the `demo` section with their defaults, still relative to the plugin root. */
export function demoFolders(config: DemoConfig): { outDir: string; output: string } {
    return { outDir: config.outDir ?? DEFAULT_DEMO_OUT_DIR, output: config.output ?? DEFAULT_OUTPUT_DIR };
}

/** Whether stills are published and where to, still relative to the plugin root; null when `demo.stills` is `false`. */
export function stillsSettings(config: DemoConfig): { output: string } | null {
    const { stills } = config;
    if (stills === false) {
        return null;
    }
    const folder = typeof stills === "object" ? stills.output : undefined;
    return { output: folder ?? config.output ?? DEFAULT_OUTPUT_DIR };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function own(record: Record<string, unknown>, key: string): unknown {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], label: string, source: string): void {
    const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        throw new Error(`${source}: unknown key(s) in "${label}": ${unknown.join(", ")}. Allowed keys: ${allowed.join(", ")}.`);
    }
}

function optionalString(record: Record<string, unknown>, key: string, label: string, source: string): string | undefined {
    const value = own(record, key);
    if (value !== undefined && (typeof value !== "string" || value === "")) {
        throw new Error(`${source}: "${label}" must be a non-empty string.`);
    }
    return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string, label: string, source: string): boolean | undefined {
    const value = own(record, key);
    if (value !== undefined && typeof value !== "boolean") {
        throw new Error(`${source}: "${label}" must be true or false.`);
    }
    return value;
}

function optionalInteger(
    record: Record<string, unknown>,
    key: string,
    label: string,
    min: number,
    max: number,
    source: string,
): number | undefined {
    const value = own(record, key);
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)) {
        throw new Error(`${source}: "${label}" must be a whole number from ${String(min)} to ${String(max)}.`);
    }
    return value;
}

function optionalOneOf<T extends string>(
    record: Record<string, unknown>,
    key: string,
    label: string,
    allowed: readonly T[],
    source: string,
): T | undefined {
    const value = own(record, key);
    if (value === undefined) {
        return undefined;
    }
    const found = allowed.find((item) => item === value);
    if (found === undefined) {
        throw new Error(`${source}: "${label}" must be one of: ${allowed.map((item) => JSON.stringify(item)).join(", ")}.`);
    }
    return found;
}

import type { DemoPhoneColors, DemoPhoneConfig } from "../config/types.js";
import type { FilmFrame } from "../e2e/demo/manifest.js";
import type { ThemeMode } from "../e2e/demo/names.js";
import { assertCssValue } from "./config.js";

/** CSS size of the composed page. Rendered at 2x, so each frame is 2000 x 1240 px. */
export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 620;
export const PAGE_SCALE = 2;

/** The stack Obsidian uses for its interface, so the captions look like the app next to them. */
export const OBSIDIAN_FONT =
    `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif`;

/** What the page is drawn with, after the theme and every layer of `demo.phone` are merged. */
export interface PhoneLayout {
    readonly background: string;
    readonly text: string;
    readonly muted: string;
    readonly accent: string;
    readonly font: string;
    readonly title: string | null;
}

/** Neutral colours close to the purple one plugin's film uses; a plugin sets its own in `demo.phone`. */
const DEFAULT_COLORS: Readonly<Record<ThemeMode, Required<DemoPhoneColors>>> = {
    light: { background: "#f4f1fd", text: "#222222", muted: "#8b8b94", accent: "#6f4fe0" },
    dark: { background: "#191722", text: "#e4e4e8", muted: "#8a8794", accent: "#a48cff" },
};

/**
 * Merges, weakest first: the defaults of the theme, then for each layer its top-level colours and then the entry of
 * the film's theme. Layers are the `phone` entries of the config, from `demo` down to the film. A film without a
 * theme gets the light defaults and no theme entry.
 */
export function resolvePhoneLayout(layers: readonly DemoPhoneConfig[], theme: ThemeMode | null): PhoneLayout {
    const defaults = DEFAULT_COLORS[theme ?? "light"];
    let { background, text, muted, accent } = defaults;
    let font = OBSIDIAN_FONT;
    let title: string | null = null;
    for (const layer of layers) {
        const themed = theme === null ? undefined : layer[theme];
        for (const source of [layer, themed]) {
            background = source?.background ?? background;
            text = source?.text ?? text;
            muted = source?.muted ?? muted;
            accent = source?.accent ?? accent;
        }
        font = layer.font ?? font;
        title = layer.title ?? title;
    }
    return { background, text, muted, accent, font, title };
}

/** Text from the plugin or a test ends up inside HTML: every character that could open markup is escaped. */
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            default:
                return "&#39;";
        }
    });
}

/** Escaped text with its line breaks kept as `<br>`. */
function lines(text: string): string {
    return text.split("\n").map(escapeHtml).join("<br>");
}

/** One caption: a text, or a heading and a text when it has a line break (`"Tap a day\nSee its value"`). */
function captionHtml(caption: string): string {
    const at = caption.indexOf("\n");
    const text = at === -1 ? "" : caption.slice(at + 1).trim();
    if (text === "") {
        return `<span>${escapeHtml(caption.trim())}</span>`;
    }
    return `<span><b>${escapeHtml(caption.slice(0, at).trim())}</b><i>${escapeHtml(text)}</i></span>`;
}

/**
 * Which caption each frame highlights: its own, or the last one before it when it has none (a frame between two
 * steps, such as the tap that opens the next one). Frames before the first caption highlight nothing.
 */
export function captionSteps(frames: readonly FilmFrame[]): (number | null)[] {
    let current: number | null = null;
    return frames.map((frame) => {
        current = frame.caption ?? current;
        return current;
    });
}

/** The page for one frame: the phone picture on the left, the caption list on the right with `step` highlighted. */
export function buildPhonePage(params: { imageDataUrl: string; captions: readonly string[]; step: number | null; layout: PhoneLayout }): string {
    const { layout, captions, step } = params;
    const css = (value: string, what: string, kind: "color" | "font" = "color"): string => assertCssValue(value, `phone layout ${what}`, kind);
    const items = captions
        .map((caption, index) => `<li${index === step ? ' class="on"' : ""}><span class="n">${String(index + 1)}</span>${captionHtml(caption)}</li>`)
        .join("");
    const heading = layout.title === null ? "" : `<h1>${lines(layout.title)}</h1>`;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${String(PAGE_WIDTH)}px;height:${String(PAGE_HEIGHT)}px;overflow:hidden;background:${css(layout.background, "background")};font-family:${css(layout.font, "font", "font")};color:${css(layout.text, "text")}}
.wrap{display:flex;align-items:center;gap:56px;height:100%;padding:0 64px;box-sizing:border-box}
.phone{display:block;max-height:540px;max-width:420px;border-radius:36px;box-shadow:0 0 0 1px rgba(127,127,127,.28),0 24px 60px rgba(0,0,0,.22),0 4px 12px rgba(0,0,0,.12);flex:none}
h1{font-size:26px;line-height:1.2;margin:0 0 22px}
ol{list-style:none;margin:0;padding:0}
li{display:flex;align-items:center;gap:14px;font-size:20px;line-height:1.3;color:${css(layout.muted, "muted colour")};padding:10px 0}
li .n{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;border:2px solid currentColor;font-size:15px;font-weight:700;flex:none}
li b{display:block;font-size:22px}
li i{display:block;font-style:normal;font-size:17px;font-weight:400;white-space:pre-line}
li.on{color:${css(layout.text, "text")};font-weight:700}
li.on .n{background:${css(layout.accent, "accent")};border-color:${css(layout.accent, "accent")};color:#fff}
</style></head><body><div class="wrap"><img class="phone" src="${params.imageDataUrl}"><div>${heading}<ol>${items}</ol></div></div></body></html>`;
}

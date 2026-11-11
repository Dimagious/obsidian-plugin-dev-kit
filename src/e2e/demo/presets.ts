/** The picture size a destination wants, in pixels, and the pixel density it is shot at. */
export interface DemoPreset {
    readonly width: number;
    readonly height: number;
    /** Device pixels per CSS pixel. The window is `width / scale` x `height / scale` CSS pixels. */
    readonly scale: number;
}

/**
 * Destinations a still can be shot for. The PNG has exactly these pixels:
 * - `readme`: 1000 px wide, the widest a README picture is shown (GitHub scales anything larger down).
 * - `listing-desktop`: 1200 x 800, the community plugin listing, desktop.
 * - `listing-phone`: 900 x 1600, the listing, phone (a 450 x 800 window at twice the density).
 * - `social`: 1200 x 630, a link preview card.
 */
export const DEMO_PRESETS = {
    readme: { width: 1000, height: 640, scale: 1 },
    "listing-desktop": { width: 1200, height: 800, scale: 1 },
    "listing-phone": { width: 900, height: 1600, scale: 2 },
    social: { width: 1200, height: 630, scale: 1 },
} as const satisfies Record<string, DemoPreset>;

export type DemoPresetName = keyof typeof DEMO_PRESETS;

/** The preset with the CSS size of the window that produces its pixels. */
export interface PresetViewport extends DemoPreset {
    readonly cssWidth: number;
    readonly cssHeight: number;
}

export function presetViewport(name: string): PresetViewport {
    if (!Object.hasOwn(DEMO_PRESETS, name)) {
        throw new Error(`Unknown still preset ${JSON.stringify(name)}. Known presets: ${Object.keys(DEMO_PRESETS).join(", ")}.`);
    }
    const preset = DEMO_PRESETS[name as DemoPresetName];
    return { ...preset, cssWidth: preset.width / preset.scale, cssHeight: preset.height / preset.scale };
}

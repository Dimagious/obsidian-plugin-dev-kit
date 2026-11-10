/** The phone the emulation produces unless asked otherwise (an iPhone 14 viewport at twice the pixel density). */
export const DEFAULT_PHONE = { width: 390, height: 844, scale: 2 } as const;

export interface MobileOptions {
    /** CSS pixels. Default 390. */
    width?: number;
    /** CSS pixels. Default 844. */
    height?: number;
    /** Device pixel ratio: a screenshot is `width * scale` pixels wide. Default 2. */
    scale?: number;
}

export interface DeviceMetrics {
    readonly width: number;
    readonly height: number;
    readonly deviceScaleFactor: number;
    readonly mobile: false;
}

/**
 * The parameters of CDP `Emulation.setDeviceMetricsOverride`. `mobile` stays false on purpose: Chromium's own mobile
 * mode adds touch events and a meta-viewport pass that Obsidian's `emulateMobile` does not expect; the override only
 * has to make the viewport phone-sized, and `emulateMobile(true)` does the rest.
 */
export function deviceMetrics(options: MobileOptions = {}): DeviceMetrics {
    const width = options.width ?? DEFAULT_PHONE.width;
    const height = options.height ?? DEFAULT_PHONE.height;
    const scale = options.scale ?? DEFAULT_PHONE.scale;
    for (const [name, value] of [["width", width], ["height", height], ["scale", scale]] as const) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`mobile(): ${name} must be a positive number, got ${String(value)}.`);
        }
    }
    return { width, height, deviceScaleFactor: scale, mobile: false };
}

/**
 * True for the errors a page call raises because the page reloaded under it. `emulateMobile()` reloads the window,
 * so the call that started it never returns; that is the only rejection `mobile()` and `desktop()` accept.
 */
export function isReloadRejection(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /execution context was destroyed|target (page, context or browser )?(has been )?closed|navigation|frame was detached/i.test(message);
}

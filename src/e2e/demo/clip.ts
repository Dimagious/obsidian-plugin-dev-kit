/** A rectangle in CSS pixels, relative to the window's top-left corner. */
export interface DemoRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface Size {
    readonly width: number;
    readonly height: number;
}

/** The pixels a capture of `css` produces at `scale`. */
export function pixelSize(css: Size, scale: number): Size {
    return { width: css.width * scale, height: css.height * scale };
}

export function assertPadding(padding: number): number {
    if (!Number.isFinite(padding) || padding < 0) {
        throw new Error(`padding must be a number of CSS pixels from 0, got ${String(padding)}.`);
    }
    return padding;
}

/**
 * The region to capture, as whole CSS pixels (a fractional clip would give a fractional pixel count and make the
 * frame size depend on rounding). The rectangle itself is snapped outward; if it sticks out of the window the shot
 * fails, because a clipped screenshot would silently be smaller than the element. Padding is decoration and is cut
 * at the window edge instead.
 */
export function resolveClip(rect: DemoRect, padding: number, bounds: Size, what: string): DemoRect {
    assertPadding(padding);
    for (const [name, value] of Object.entries(rect)) {
        if (!Number.isFinite(value)) {
            throw new Error(`${what}: the clip has ${name} ${String(value)}, which is not a number.`);
        }
    }
    if (rect.width <= 0 || rect.height <= 0) {
        throw new Error(`${what}: the clip is ${String(rect.width)} x ${String(rect.height)}; it needs a width and a height above 0.`);
    }
    const left = Math.floor(rect.x);
    const top = Math.floor(rect.y);
    const right = Math.ceil(rect.x + rect.width);
    const bottom = Math.ceil(rect.y + rect.height);
    if (left < 0 || top < 0 || right > bounds.width || bottom > bounds.height) {
        throw new Error(
            `${what}: the clip spans x ${String(left)}..${String(right)}, y ${String(top)}..${String(bottom)}, ` +
                `outside the ${String(bounds.width)} x ${String(bounds.height)} window. ` +
                `Make the window bigger, scroll the target into view, or clip a smaller area.`,
        );
    }
    const x = Math.max(0, left - Math.ceil(padding));
    const y = Math.max(0, top - Math.ceil(padding));
    return {
        x,
        y,
        width: Math.min(bounds.width, right + Math.ceil(padding)) - x,
        height: Math.min(bounds.height, bottom + Math.ceil(padding)) - y,
    };
}

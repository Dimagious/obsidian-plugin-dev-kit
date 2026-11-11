import type { Size } from "./clip.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Signature (8), IHDR length (4), "IHDR" (4), width (4), height (4). */
const HEADER_BYTES = 24;

/** Width and height in pixels, from the IHDR chunk. Fails on anything that is not a PNG. */
export function readPngSize(png: Buffer): Size {
    if (png.length < HEADER_BYTES || !png.subarray(0, SIGNATURE.length).equals(SIGNATURE) || png.toString("latin1", 12, 16) !== "IHDR") {
        throw new Error("The capture is not a PNG (no PNG signature and IHDR chunk). The page may have closed during the screenshot.");
    }
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * The pixel-density guard: the frame must be exactly the CSS size times the scale. A frame that is half the expected
 * size means the capture ran at the display's density instead of the requested one, and would encode into a blurry film.
 */
export function assertFrameSize(png: Buffer, expected: Size, scale: number, what: string): Size {
    const actual = readPngSize(png);
    if (actual.width !== expected.width || actual.height !== expected.height) {
        throw new Error(
            `${what}: the frame is ${String(actual.width)} x ${String(actual.height)} px, expected ${String(expected.width)} x ${String(expected.height)} ` +
                `(the shot area at scale ${String(scale)}). The capture did not run at the requested pixel density; ` +
                `check that nothing else resets the window's device metrics (a second CDP session, for one).`,
        );
    }
    return actual;
}

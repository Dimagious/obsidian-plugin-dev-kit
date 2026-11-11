import zlib from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
}

export interface Rgb {
    readonly r: number;
    readonly g: number;
    readonly b: number;
}

/** A box painted over the background, in pixels. */
export interface Box extends Rgb {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * A real, decodable 8-bit RGB PNG: a solid background with optional boxes. The encoder tests run ffmpeg on these,
 * so unlike `fakePng` (a header only) every byte has to be valid.
 */
export function realPng(width: number, height: number, background: Rgb, boxes: readonly Box[] = []): Buffer {
    const stride = width * 3 + 1;
    const raw = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        raw[y * stride] = 0;
        for (let x = 0; x < width; x++) {
            const box = boxes.find((item) => x >= item.x && x < item.x + item.width && y >= item.y && y < item.y + item.height);
            const colour = box ?? background;
            const at = y * stride + 1 + x * 3;
            raw[at] = colour.r;
            raw[at + 1] = colour.g;
            raw[at + 2] = colour.b;
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", zlib.deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

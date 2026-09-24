import {crc32, deflateSync} from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const BIT_DEPTH = 8;
const COLOR_TYPE_RGBA = 6;

/** Encodes 8-bit RGBA pixels, row by row from the top, as a PNG. */
export function encodePng(pixels: Uint8Array, width: number, height: number): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.writeUInt8(BIT_DEPTH, 8);
    header.writeUInt8(COLOR_TYPE_RGBA, 9);

    const rowLength = width * 4;
    const scanlines = Buffer.alloc((rowLength + 1) * height);
    for (let y = 0; y < height; y++) {
        scanlines.set(pixels.subarray(y * rowLength, (y + 1) * rowLength), y * (rowLength + 1) + 1);
    }

    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(scanlines)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

function chunk(type: string, data: Buffer): Buffer {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
}

import pixelmatch from 'pixelmatch';
import {PNG} from 'pngjs';

/** 8-bit RGBA pixels, row by row from the top. */
export type Image = {
    width: number;
    height: number;
    data: Uint8Array;
};

const GAP = 8;
const GAP_SHADE = 255;

export function decodePng(png: Uint8Array): Image {
    const {width, height, data} = PNG.sync.read(Buffer.from(png));
    return {width, height, data};
}

export function encodePng({width, height, data}: Image): Buffer {
    const png = new PNG({width, height});
    png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return PNG.sync.write(png);
}

/**
 * Returns an image that shows where two images of the same size differ, in red over a faded copy of the first,
 * and how many pixels differ. Anti-aliasing differences are left out, the way the MapLibre render tests count.
 */
export function diffImages(first: Image, second: Image): {diff: Image; changed: number} {
    if (first.width !== second.width || first.height !== second.height) {
        throw new Error(`The images have different sizes: ${first.width}x${first.height} and ${second.width}x${second.height}.`);
    }
    const data = new Uint8Array(first.width * first.height * 4);
    const changed = pixelmatch(first.data, second.data, data, first.width, first.height, {threshold: 0.1});
    return {diff: {width: first.width, height: first.height, data}, changed};
}

/** Places images of the same height next to each other, from left to right, with a white gap between them. */
export function sideBySide(images: Image[]): Image {
    const height = images[0].height;
    const width = images.reduce((sum, image) => sum + image.width, 0) + GAP * (images.length - 1);
    const data = new Uint8Array(width * height * 4).fill(GAP_SHADE);
    let left = 0;
    for (const image of images) {
        for (let y = 0; y < height; y++) {
            const row = image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4);
            data.set(row, (y * width + left) * 4);
        }
        left += image.width + GAP;
    }
    return {width, height, data};
}

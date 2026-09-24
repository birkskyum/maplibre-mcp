import {PNG} from 'pngjs';
import {describe, expect, test} from 'vitest';
import {connect, textOf} from './connect.js';

const BLUE_STYLE = {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#3366cc'}}]};

/** Returns the RGBA values of the center pixel of the image in a tool result. */
function centerPixel(result: {content?: unknown}): number[] {
    const items = Array.isArray(result.content) ? result.content : [];
    const png = PNG.sync.read(Buffer.from(items.find(item => item.type === 'image').data, 'base64'));
    const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
    return [...png.data.subarray(offset, offset + 4)];
}

describe('render_style', () => {
    test('draws the style with MapLibre GL JS', async () => {
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'render_style', arguments: {style: BLUE_STYLE, width: 120, height: 80}});
        expect(centerPixel(result)).toEqual([0x33, 0x66, 0xcc, 255]);
        expect(textOf(result)).toContain('Rendered with MapLibre GL JS 6.');
    });

    test('draws the style with MapLibre Native', async () => {
        const client = await connect('native');
        const result = await client.callTool({name: 'render_style', arguments: {style: BLUE_STYLE, renderer: 'native', width: 120, height: 80}});
        expect(centerPixel(result)).toEqual([0x33, 0x66, 0xcc, 255]);
        expect(textOf(result)).toContain('Rendered with MapLibre Native 6.');
    });

    test('fits the camera to bounds', async () => {
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'render_style', arguments: {style: BLUE_STYLE, bounds: [10, 50, 20, 60], width: 400, height: 300}});
        expect(textOf(result)).toContain('Camera: center [15, 55.31379], zoom 3.24, bearing 0, pitch 0.');
    });

    test('reports icons that the sprite lacks', async () => {
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'render_style', arguments: {width: 120, height: 80, style: {
            version: 8,
            sources: {point: {type: 'geojson', data: {type: 'Point', coordinates: [0, 0]}}},
            layers: [{id: 'icon', type: 'symbol', source: 'point', layout: {'icon-image': 'harbor'}}],
        }}});
        expect(textOf(result)).toContain('Images the style uses but the sprite lacks: harbor.');
    });

    test('points to Native\'s missing features', async () => {
        const client = await connect('native');
        const result = await client.callTool({name: 'render_style', arguments: {style: {...BLUE_STYLE, sky: {'sky-color': '#88c6fc'}}, width: 120, height: 80}});
        expect(textOf(result)).toContain('MapLibre Native does not draw the sky yet.');
    });
});

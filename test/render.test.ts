import {PNG} from 'pngjs';
import {describe, expect, test} from 'vitest';
import {connect, serveJson, textOf} from './connect.js';

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

    test('reports font stacks whose glyphs do not load', async () => {
        const client = await connect('gl-js');
        const {origin, server} = await serveJson({});
        try {
            const result = await client.callTool({name: 'render_style', arguments: {width: 120, height: 80, style: {
                version: 8,
                glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`,
                sources: {point: {type: 'geojson', data: {type: 'Point', coordinates: [0, 0]}}},
                layers: [{id: 'label', type: 'symbol', source: 'point', layout: {'text-field': 'Harbor', 'text-font': ['Noto Sans Italic']}}],
            }}});
            expect(textOf(result)).toContain('Glyphs did not load for these font stacks, so their text is drawn with local fonts: "Noto Sans Italic" (HTTP 404).');
        } finally {
            server.close();
        }
    });

    test('places the camera from where it is and what it looks at', async () => {
        const client = await connect('gl-js');
        const high = textOf(await client.callTool({name: 'render_style', arguments: {style: BLUE_STYLE, cameraPosition: [0, -0.01, 1000], lookAt: [0, 0], width: 120, height: 80}}));
        const [, zoom, bearing, pitch] = /Camera: center \[0, 0\], zoom ([\d.]+), bearing (-?[\d.]+), pitch ([\d.]+)\./.exec(high) ?? [];
        expect(Number(zoom)).toBeGreaterThan(10);
        expect(Number(bearing)).toBeCloseTo(0, 1);
        expect(Number(pitch)).toBeCloseTo(48.07, 0);
        expect(high).not.toContain('maxPitch');
        const low = textOf(await client.callTool({name: 'render_style', arguments: {style: BLUE_STYLE, cameraPosition: [0, -0.01, 100], lookAt: [0, 0], width: 120, height: 80}}));
        expect(low).toContain('A map shows this view only with maxPitch 85 or more, since its default is 60.');
    });

    test('needs a camera position and a point to look at together, and a renderer that can place them', async () => {
        const client = await connect('gl-js,native');
        const alone = await client.callTool({name: 'render_style', arguments: {style: BLUE_STYLE, lookAt: [0, 0]}});
        expect(textOf(alone)).toContain('Pass cameraPosition and lookAt together.');
        const native = await client.callTool({name: 'render_style', arguments: {style: BLUE_STYLE, renderer: 'native', cameraPosition: [0, -0.01, 1000], lookAt: [0, 0]}});
        expect(textOf(native)).toContain('The native renderer cannot place the camera from cameraPosition and lookAt.');
    });

    test('points to Native\'s missing features', async () => {
        const client = await connect('native');
        const result = await client.callTool({name: 'render_style', arguments: {style: {...BLUE_STYLE, sky: {'sky-color': '#88c6fc'}}, width: 120, height: 80}});
        expect(textOf(result)).toContain('MapLibre Native does not draw the sky yet.');
    });
});

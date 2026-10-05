import {cp, mkdtemp, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PNG} from 'pngjs';
import {describe, expect, test} from 'vitest';
import {connect, textOf} from './connect.js';

const require = createRequire(import.meta.url);
const MAPLIBRE_DIST = path.dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));

/** Returns the RGBA values of the center pixel of the image in a tool result. */
function centerPixel(result: {content?: unknown}): number[] {
    const items = Array.isArray(result.content) ? result.content : [];
    const png = PNG.sync.read(Buffer.from(items.find(item => item.type === 'image').data, 'base64'));
    const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * 4;
    return [...png.data.subarray(offset, offset + 4)];
}

async function pageFolder(html: string): Promise<string> {
    const folder = await mkdtemp(path.join(tmpdir(), 'maplibre-mcp-page-'));
    await writeFile(path.join(folder, 'index.html'), html);
    return folder;
}

describe('render_page', () => {
    test('draws the map of a page, runs a script in it and reports its camera', async () => {
        const folder = await pageFolder(`<!doctype html>
            <link rel="stylesheet" href="maplibre/maplibre-gl.css">
            <style>html, body, #map { margin: 0; height: 100%; }</style>
            <div id="map"></div>
            <script type="module">
                import * as maplibregl from './maplibre/maplibre-gl.mjs';
                window.map = new maplibregl.Map({
                    container: 'map', center: [10, 50], zoom: 4, attributionControl: false,
                    style: {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#3366cc'}}]},
                });
            </script>`);
        await cp(MAPLIBRE_DIST, path.join(folder, 'maplibre'), {recursive: true, filter: source => !source.endsWith('.map')});
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'render_page', arguments: {
            path: path.join(folder, 'index.html'), script: 'map.jumpTo({center: [20, 40], zoom: 6}); map.getStyle().layers.length', width: 120, height: 80,
        }});
        expect(centerPixel(result)).toEqual([0x33, 0x66, 0xcc, 255]);
        expect(textOf(result)).toContain('Camera: center [20, 40], zoom 6, bearing 0, pitch 0.');
        expect(textOf(result)).toContain('Rendered with MapLibre GL JS 6.');
        expect(textOf(result)).toContain('The script returned: 1');
    });

    test('runs a script that ends in a camera call, which evaluates to the map itself', async () => {
        const folder = await pageFolder(`<!doctype html>
            <link rel="stylesheet" href="maplibre/maplibre-gl.css">
            <style>html, body, #map { margin: 0; height: 100%; }</style>
            <div id="map"></div>
            <script type="module">
                import * as maplibregl from './maplibre/maplibre-gl.mjs';
                window.map = new maplibregl.Map({
                    container: 'map', center: [10, 50], zoom: 4, attributionControl: false,
                    style: {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#3366cc'}}]},
                });
            </script>`);
        await cp(MAPLIBRE_DIST, path.join(folder, 'maplibre'), {recursive: true, filter: source => !source.endsWith('.map')});
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'render_page', arguments: {
            path: path.join(folder, 'index.html'), script: 'map.jumpTo({center: [20, 40], zoom: 6})', width: 120, height: 80,
        }});
        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toContain('Camera: center [20, 40], zoom 6, bearing 0, pitch 0.');
        expect(textOf(result)).toContain('The script returned an object that cannot be shown, like the map itself.');
    });

    test('reports the errors and failed requests of a page, also when it keeps no map', async () => {
        const folder = await pageFolder(`<!doctype html>
            <body style="margin: 0; background: #3366cc">
            <img src="missing.png">
            <script>console.error('The tiles are gone'); window.answer = 42;</script>`);
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'render_page', arguments: {path: path.join(folder, 'index.html'), script: 'window.answer + 1', width: 120, height: 80}});
        const text = textOf(result);
        expect(centerPixel(result)).toEqual([0x33, 0x66, 0xcc, 255]);
        expect(text).toContain('The page keeps no map in window.map');
        expect(text).toContain('The script returned: 43');
        expect(text).toContain('Errors in the page:\n  The tiles are gone');
        expect(text).toMatch(/Requests that failed:\n {2}HTTP 404 http:\/\/127\.0\.0\.1:\d+\/missing\.png/);
    }, 20_000);

    test('says where it looked for a page that is not there, and needs one page', async () => {
        const client = await connect('gl-js');
        const missing = await client.callTool({name: 'render_page', arguments: {path: 'no-such-folder/index.html'}});
        expect(textOf(missing)).toContain(`There is no file at ${path.resolve('no-such-folder/index.html')}.`);
        const none = await client.callTool({name: 'render_page', arguments: {}});
        expect(textOf(none)).toContain('Pass exactly one of path and url.');
    });
});

import {createServer, type Server} from 'node:http';
import {PNG} from 'pngjs';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {connect, serveJson, textOf} from './connect.js';

describe('martin_list_sources', () => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        ({server, origin} = await serveJson({
            '/catalog': {
                tiles: {roads: {content_type: 'application/x-protobuf', name: 'public.roads'}},
                sprites: {icons: {images: ['bus', 'train']}},
                fonts: {'Noto Sans Regular': {family: 'Noto Sans', style: 'Regular'}},
            },
        }));
    });

    afterAll(() => {
        server.close();
    });

    test('gives the URLs a style needs for each source', async () => {
        const client = await connect('martin');
        const text = textOf(await client.callTool({name: 'martin_list_sources', arguments: {url: `${origin}/`}}));
        expect(text).toContain(`  roads: ${origin}/roads (vector, public.roads)`);
        expect(text).toContain(`  icons: ${origin}/sprite/icons (2 images)`);
        expect(text).toContain(`Fonts, with "glyphs": "${origin}/font/{fontstack}/{range}" in the style:\n  Noto Sans Regular`);
    });
});

describe('render_style with Martin', () => {
    const requested: string[] = [];
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const png = new PNG({width: 64, height: 64});
        server = createServer((request, response) => {
            if (request.url === '/style/basic') {
                response.writeHead(200, {'content-type': 'application/json'}).end('{"version": 8, "sources": {}, "layers": []}');
                return;
            }
            requested.push(request.url ?? '');
            response.writeHead(200, {'content-type': 'image/png'}).end(PNG.sync.write(png));
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    });

    afterAll(() => {
        server.close();
    });

    test('asks Martin for a static image of the style it serves', async () => {
        const client = await connect('martin');
        const result = await client.callTool({name: 'render_style', arguments: {
            url: `${origin}/style/basic`,
            center: [11.25, 43.77],
            zoom: 13,
            bearing: 20,
            pitch: 40,
            width: 64,
            height: 64,
        }});
        expect(requested).toEqual(['/style/basic/static/11.25,43.77,13@20,40/64x64.png']);
        expect(textOf(result)).toContain(`Rendered by the Martin server at ${origin}, with MapLibre Native.`);
    });

    test('explains that Martin draws only the styles it serves', async () => {
        const client = await connect('martin');
        const result = await client.callTool({name: 'render_style', arguments: {style: {version: 8, sources: {}, layers: []}}});
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('The martin renderer draws the styles that a Martin server serves');
    });
});

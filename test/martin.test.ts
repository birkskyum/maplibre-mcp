import type {Server} from 'node:http';
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

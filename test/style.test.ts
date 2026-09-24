import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import type {Server} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {connect, serveJson, textOf} from './connect.js';

describe('validate_style', () => {
    test('lists each problem with the path to its property', async () => {
        const client = await connect('style');
        const result = await client.callTool({name: 'validate_style', arguments: {style: {
            version: 8,
            sources: {},
            layers: [{id: 'water', type: 'background', paint: {'background-colour': 'blue'}}],
        }}});
        expect(result.structuredContent).toEqual({problems: [
            {severity: 'error', message: 'layers[0].paint.background-colour: unknown property "background-colour"'},
        ]});
    });

    test('says when the style is valid', async () => {
        const client = await connect('style');
        const result = await client.callTool({name: 'validate_style', arguments: {style: {version: 8, sources: {}, layers: []}}});
        expect(textOf(result)).toBe('The style is valid.');
    });

    test('explains that MapLibre has no mapbox:// URLs', async () => {
        const client = await connect('style');
        const result = await client.callTool({name: 'validate_style', arguments: {url: 'mapbox://styles/mapbox/streets-v12'}});
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('MapLibre does not resolve mapbox:// URLs (mapbox://styles/mapbox/streets-v12).');
    });

    test('needs exactly one way to get the style', async () => {
        const client = await connect('style');
        const result = await client.callTool({name: 'validate_style', arguments: {}});
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('Pass exactly one of style, url and path.');
    });
});

describe('describe_style_spec', () => {
    test('describes a paint property and which versions support it', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'describe_style_spec', arguments: {name: 'fill-extrusion-height'}}));
        expect(text).toContain('fill-extrusion-height (paint property of fill-extrusion layers)');
        expect(text).toContain('basic functionality: GL JS 0.27.0, Android 5.1.0, iOS 3.6.0');
    });

    test('describes the syntax of an expression', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'describe_style_spec', arguments: {name: 'step'}}));
        expect(text).toContain('Syntax: ["step", input, output_0, stop_input_1, stop_output_1, ..., stop_input_n, stop_output_n]');
    });

    test('suggests the name a misspelling means', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'describe_style_spec', arguments: {name: 'fill-colour'}}));
        expect(text).toBe('"fill-colour" is not in the MapLibre Style Specification. Did you mean: fill-color?');
    });
});

describe('describe_sources', () => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        ({server, origin} = await serveJson({
            '/tiles.json': {minzoom: 0, maxzoom: 14, vector_layers: [{id: 'roads', fields: {class: 'String', name: 'String'}}]},
        }));
    });

    afterAll(() => {
        server.close();
    });

    test('lists the source layers and fields of a vector source', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'describe_sources', arguments: {style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            layers: [],
        }}}));
        expect(text).toContain('  Source layers and their fields:\n    roads: class, name');
    });

    test('finds a layer that uses a source layer the source lacks', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'describe_sources', arguments: {style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            layers: [{id: 'highways', type: 'line', source: 'streets', 'source-layer': 'transportation'}],
        }}}));
        expect(text).toContain('Layer "highways" uses the source layer "transportation", which "streets" does not have. It has: roads.');
    });

    test('finds a layer that reads a field the source layer lacks', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'describe_sources', arguments: {style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            layers: [{id: 'highways', type: 'line', source: 'streets', 'source-layer': 'roads', filter: ['==', 'kind', 'highway']}],
        }}}));
        expect(text).toContain('Layer "highways" reads the field "kind", which "streets" does not list for "roads".');
    });

    test('finds a layer that reads a field the GeoJSON features lack', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'describe_sources', arguments: {style: {
            version: 8,
            sources: {cities: {type: 'geojson', data: {type: 'Feature', geometry: {type: 'Point', coordinates: [12.5, 55.7]}, properties: {pop: 1}}}},
            layers: [{id: 'dots', type: 'circle', source: 'cities', paint: {'circle-radius': ['get', 'population']}}],
        }}}));
        expect(text).toContain('Layer "dots" reads the field "population", which "cities" does not list.');
    });
});

describe('format_style', () => {
    test('formats a style file in place', async () => {
        const file = path.join(await mkdtemp(path.join(tmpdir(), 'maplibre-mcp-')), 'style.json');
        await writeFile(file, '{"layers": [], "sources": {}, "version": 8}');
        const client = await connect('style');
        const result = await client.callTool({name: 'format_style', arguments: {path: file}});
        expect(textOf(result)).toBe(`Formatted ${file}.`);
        expect(await readFile(file, 'utf8')).toBe('{"version": 8, "sources": {}, "layers": []}\n');
    });
});

describe('migrate_style', () => {
    test('turns legacy filters and functions into expressions', async () => {
        const client = await connect('style');
        const result = await client.callTool({name: 'migrate_style', arguments: {style: {
            version: 8,
            sources: {},
            layers: [{id: 'roads', type: 'line', source: 's', filter: ['==', 'class', 'motorway'], paint: {'line-width': {stops: [[5, 1], [10, 4]]}}}],
        }}});
        expect(JSON.parse(textOf(result)).layers[0]).toMatchObject({
            filter: ['==', ['get', 'class'], 'motorway'],
            paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 4]},
        });
    });
});

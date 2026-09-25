import {geoJSONToTile} from '@maplibre/geojson-vt';
import {encodeTile} from '@maplibre/mlt';
import {fromGeojsonVt} from '@maplibre/vt-pbf';
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

describe('inspect_tile', () => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const roads = geoJSONToTile({type: 'FeatureCollection', features: [
            {type: 'Feature', geometry: {type: 'LineString', coordinates: [[0, 0], [10, 10]]}, properties: {class: 'primary'}},
            {type: 'Feature', geometry: {type: 'LineString', coordinates: [[0, 10], [10, 0]]}, properties: {class: 'primary'}},
            {type: 'Feature', geometry: {type: 'LineString', coordinates: [[5, 0], [5, 10]]}, properties: {class: 'minor', oneway: 1}},
        ]}, 0, 0, 0);
        const places = encodeTile([{name: 'places', extent: 4096, features: [
            {geometry: {type: 'Point', coordinates: [100, 100]}, properties: {kind: 'city'}},
            {geometry: {type: 'Point', coordinates: [200, 300]}, properties: {kind: 'town'}},
        ]}]);
        ({server, origin} = await serveJson({
            '/roads.json': {tiles: ['/roads/{z}/{x}/{y}.pbf'], maxzoom: 0},
            '/roads/0/0/0.pbf': fromGeojsonVt({roads}),
            '/places/0/0/0.mlt': places,
        }));
    });

    afterAll(() => {
        server.close();
    });

    test('lists the values of each field in a tile', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'inspect_tile', arguments: {source: `${origin}/roads.json`, center: [5, 5], zoom: 3}}));
        expect(text).toContain('The source has no tiles above zoom 0, so maps show this tile at zoom 3 too.');
        expect(text).toContain('roads: 3 features (3 LineString)\n  class: "primary" (2), "minor" (1)\n  oneway (in 1 of 3): 1 (1)');
    });

    test('reads the MLT tiles of a style source', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'inspect_tile', arguments: {
            style: {version: 8, sources: {places: {type: 'vector', tiles: [`${origin}/places/{z}/{x}/{y}.mlt`], maxzoom: 0, encoding: 'mlt'}}, layers: []},
            center: [0, 0],
            zoom: 0,
        }}));
        expect(text).toContain(`Tile 0/0/0 of source "places" (${origin}/places/{z}/{x}/{y}.mlt), at [0, 0], MLT`);
        expect(text).toContain('places: 2 features (2 Point)\n  kind: "city" (1), "town" (1)');
    });

    test('explains that it reads vector tiles', async () => {
        const client = await connect('style');
        const result = await client.callTool({name: 'inspect_tile', arguments: {
            style: {version: 8, sources: {satellite: {type: 'raster', tiles: [`${origin}/{z}/{x}/{y}.png`]}}, layers: []},
            source: 'satellite',
        }});
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('"satellite" is a raster source, and inspect_tile reads vector tiles.');
    });
});

describe('debug_layers', () => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        const roads = geoJSONToTile({type: 'FeatureCollection', features: [
            {type: 'Feature', geometry: {type: 'LineString', coordinates: [[0, 0], [10, 10]]}, properties: {class: 'primary'}},
            {type: 'Feature', geometry: {type: 'LineString', coordinates: [[0, 10], [10, 0]]}, properties: {class: 'primary'}},
            {type: 'Feature', geometry: {type: 'LineString', coordinates: [[5, 0], [5, 10]]}, properties: {class: 'minor'}},
        ]}, 0, 0, 0);
        const water = geoJSONToTile({type: 'Feature', geometry: {type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}, properties: {}}, 0, 0, 0);
        ({server, origin} = await serveJson({
            '/tiles.json': {tiles: ['/{z}/{x}/{y}.pbf'], maxzoom: 0},
            '/0/0/0.pbf': fromGeojsonVt({roads, water}),
            '/sprite.json': {cafe: {x: 0, y: 0, width: 16, height: 16, pixelRatio: 1}},
        }));
    });

    afterAll(() => {
        server.close();
    });

    test('says which layers draw at a place', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'debug_layers', arguments: {center: [5, 5], zoom: 3, style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            layers: [{id: 'water', type: 'fill', source: 'streets', 'source-layer': 'water'}],
        }}}));
        expect(text).toContain('At [5, 5], zoom 3: 1 layer draws.');
        expect(text).toContain('water (fill): draws 1 of the 1 feature in source layer "water".');
    });

    test('lists the values the data has when a filter matches nothing', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'debug_layers', arguments: {center: [5, 5], zoom: 3, style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            layers: [{id: 'motorways', type: 'line', source: 'streets', 'source-layer': 'roads', filter: ['==', ['get', 'class'], 'motorway']}],
        }}}));
        expect(text).toContain('motorways (line): draws nothing, since its filter matches none of the 3 features in source layer "roads".');
        expect(text).toContain('  roads.class: "primary" (2), "minor" (1)');
    });

    test('names a field of a filter that no feature has', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'debug_layers', arguments: {center: [5, 5], zoom: 3, style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            layers: [{id: 'highways', type: 'line', source: 'streets', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'highway']}],
        }}}));
        expect(text).toContain('No feature has the field "kind".');
    });

    test('finds a source layer the tile lacks', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'debug_layers', arguments: {center: [5, 5], zoom: 3, style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            layers: [{id: 'buildings', type: 'fill', source: 'streets', 'source-layer': 'buildings'}],
        }}}));
        expect(text).toContain('buildings (fill): draws nothing, since the tile has no source layer "buildings". It has: roads, water.');
    });

    test('finds a fill layer on data without polygons', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'debug_layers', arguments: {center: [5, 5], zoom: 3, style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            layers: [{id: 'road-areas', type: 'fill', source: 'streets', 'source-layer': 'roads'}],
        }}}));
        expect(text).toContain('road-areas (fill): draws nothing, since it matches 3 of the 3 features in source layer "roads", but none are polygons, which a fill layer needs.');
    });

    test('finds paint that hides a layer at the zoom', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'debug_layers', arguments: {center: [5, 5], zoom: 3, style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            layers: [{id: 'roads', type: 'line', source: 'streets', 'source-layer': 'roads', paint: {'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0, 10, 4]}}],
        }}}));
        expect(text).toContain('roads (line): draws nothing, since line-width is 0 at zoom 3.');
    });

    test('finds icons the sprite lacks', async () => {
        const client = await connect('style');
        const text = textOf(await client.callTool({name: 'debug_layers', arguments: {center: [5, 5], zoom: 3, style: {
            version: 8,
            sources: {streets: {type: 'vector', url: `${origin}/tiles.json`}},
            sprite: `${origin}/sprite`,
            layers: [{id: 'shops', type: 'symbol', source: 'streets', 'source-layer': 'roads', layout: {'icon-image': '{class}_shop'}}],
        }}}));
        expect(text).toContain('shops (symbol): draws nothing, since the sprite has none of the icons it uses, like "primary_shop", "minor_shop".');
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

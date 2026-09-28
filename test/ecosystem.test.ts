import type {Server} from 'node:http';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {connect, serveJson, textOf} from './connect.js';

const catalog = {
    schemaVersion: 1,
    site: 'https://buildwithmaplibre.com/',
    generatedAt: '2026-09-28T12:00:00.000Z',
    libraries: [
        {
            slug: 'react-map-gl', name: 'React Map GL', kind: 'sdk', tagline: 'React wrapper for MapLibre GL JS',
            description: 'A declarative React API for MapLibre GL JS.', link: 'https://visgl.github.io/react-map-gl/',
            url: 'https://buildwithmaplibre.com/sdks/react-map-gl', repository: 'https://github.com/visgl/react-map-gl',
            license: 'MIT', platforms: ['Web'], languages: ['JS / TS'], frameworks: ['React'], renderers: ['MapLibre GL JS'], weight: 5,
        },
        {
            slug: 'maplibre-swiftui-dsl', name: 'MapLibre SwiftUI DSL', kind: 'sdk', tagline: 'SwiftUI bindings for MapLibre Native',
            description: 'Declarative SwiftUI maps.', link: 'https://github.com/maplibre/swiftui-dsl',
            url: 'https://buildwithmaplibre.com/sdks/maplibre-swiftui-dsl', platforms: ['iOS'], languages: ['Swift'],
            frameworks: ['SwiftUI'], renderers: ['MapLibre Native'], weight: 3,
        },
        {
            slug: 'valhalla', name: 'Valhalla', kind: 'navigation', tagline: 'Open-source routing engine',
            description: 'A routing engine for OpenStreetMap data.', link: 'https://github.com/valhalla/valhalla',
            url: 'https://buildwithmaplibre.com/navigation/valhalla', platforms: ['Server'], languages: ['C++'], frameworks: [], renderers: [],
        },
    ],
    basemaps: [
        {
            slug: 'openfreemap-liberty', name: 'Liberty', provider: 'OpenFreeMap', description: 'A detailed OpenStreetMap basemap.',
            styleUrl: 'https://tiles.openfreemap.org/styles/liberty', free: true, url: 'https://buildwithmaplibre.com/basemaps/styles/openfreemap-liberty',
        },
        {
            slug: 'maptiler-dataviz-dark', name: 'Dataviz Dark', provider: 'MapTiler', description: 'A dark style for data visualization.',
            styleUrl: 'https://api.maptiler.com/maps/dataviz-dark/style.json', free: false, url: 'https://buildwithmaplibre.com/basemaps/styles/maptiler-dataviz-dark',
        },
        {
            slug: 'aws-terrarium', name: 'Terrarium Elevation', provider: 'AWS Open Data', description: 'Global elevation tiles.',
            tileUrl: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', free: true, url: 'https://buildwithmaplibre.com/basemaps/styles/aws-terrarium',
        },
    ],
    services: [
        {slug: 'stadia-routing', name: 'Stadia Maps', kind: 'routing-api', link: 'https://docs.stadiamaps.com/routing/', description: 'Hosted Valhalla routing.', sponsored: true},
    ],
    products: [
        {
            slug: 'immich', name: 'Immich', tagline: 'Self-hosted photo and video backup', description: 'Shows geotagged photos on a map.',
            link: 'https://immich.app', url: 'https://buildwithmaplibre.com/products/immich', categories: ['Social & Messaging'],
            renderers: ['MapLibre GL JS'], platforms: ['Web', 'Android', 'iOS'], frameworks: [],
            uses: {sdks: ['react-map-gl'], plugins: [], routing: ['valhalla'], geocoding: [], tileInfrastructure: []}, added: '2026-03-29', weight: 4,
        },
    ],
    makers: [
        {slug: 'geoagency', name: 'Geo Agency', link: 'https://geo.example', description: 'Builds MapLibre apps for clients.', consultancy: true, url: 'https://buildwithmaplibre.com/makers/geoagency'},
    ],
};

describe('ecosystem', () => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        ({server, origin} = await serveJson({'/catalog.json': catalog, '/v2.json': {...catalog, schemaVersion: 2}}));
        process.env.MAPLIBRE_MCP_CATALOG_URL = `${origin}/catalog.json`;
    });

    afterAll(() => {
        delete process.env.MAPLIBRE_MCP_CATALOG_URL;
        server.close();
    });

    test('finds an SDK by framework, with its links and page', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'react'}}));
        expect(text).toContain('React Map GL (sdk): React wrapper for MapLibre GL JS');
        expect(text).toContain('  Web · React · JS / TS · MapLibre GL JS · MIT');
        expect(text).toContain('  https://visgl.github.io/react-map-gl/, repository https://github.com/visgl/react-map-gl');
        expect(text).toContain('  More: https://buildwithmaplibre.com/sdks/react-map-gl');
        expect(text).toContain('From https://buildwithmaplibre.com/catalog.json, generated 2026-09-28.');
    });

    test('filters by platform', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {kind: 'sdk', platform: 'iOS'}}));
        expect(text).toContain('1 entry matches kind sdk, platform iOS:');
        expect(text).toContain('MapLibre SwiftUI DSL (sdk)');
        expect(text).not.toContain('React Map GL');
    });

    test('includes the hosted services of a kind, and discloses sponsored listings', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {kind: 'navigation'}}));
        expect(text).toContain('Valhalla (navigation): Open-source routing engine');
        expect(text).toContain('Stadia Maps (hosted routing API): Hosted Valhalla routing.');
        expect(text).toContain('  https://docs.stadiamaps.com/routing/ (a sponsored listing on Build with MapLibre)');
    });

    test('says which libraries a product is built with', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'valhalla', kind: 'product'}}));
        expect(text).toContain('Immich (product): Self-hosted photo and video backup');
        expect(text).toContain('  Social & Messaging · MapLibre GL JS · Web, Android, iOS · built with React Map GL, Valhalla');
        expect(text).toContain('  Map: https://immich.app');
    });

    test('finds consultancies', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {kind: 'consultant'}}));
        expect(text).toContain('Geo Agency (consultancy): Builds MapLibre apps for clients.');
    });

    test('says when nothing matches', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'cobol'}}));
        expect(text).toContain('Nothing in Build with MapLibre matches "cobol". Try fewer or broader words, or another kind.');
    });

    test('lists free basemaps with their style URLs first', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'find_basemaps', arguments: {}}));
        expect(text.indexOf('Liberty by OpenFreeMap, free, no API key')).toBeLessThan(text.indexOf('Dataviz Dark by MapTiler, needs an API key'));
        expect(text).toContain('  Style URL: https://tiles.openfreemap.org/styles/liberty');
        expect(text).toContain('  Tiles, to add as a source: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png');
        expect(text).toContain('fail until the provider\'s key is added to them.');
    });

    test('filters basemaps by words and by whether they need a key', async () => {
        const client = await connect('ecosystem');
        const dark = textOf(await client.callTool({name: 'find_basemaps', arguments: {query: 'dark'}}));
        expect(dark).toContain('Dataviz Dark by MapTiler');
        expect(dark).not.toContain('Liberty');
        const free = textOf(await client.callTool({name: 'find_basemaps', arguments: {free: true}}));
        expect(free).not.toContain('Dataviz Dark');
        expect(free).not.toContain('need an API key fail');
    });

    test('refuses a catalog with another schema version', async () => {
        process.env.MAPLIBRE_MCP_CATALOG_URL = `${origin}/v2.json`;
        try {
            const client = await connect('ecosystem');
            const result = await client.callTool({name: 'find_basemaps', arguments: {}});
            expect(result.isError).toBe(true);
            expect(textOf(result)).toContain('has schema version 2, and this maplibre-mcp reads version 1. Update maplibre-mcp.');
        } finally {
            process.env.MAPLIBRE_MCP_CATALOG_URL = `${origin}/catalog.json`;
        }
    });

    test('explains when the catalog cannot be loaded', async () => {
        process.env.MAPLIBRE_MCP_CATALOG_URL = `${origin}/missing.json`;
        try {
            const client = await connect('ecosystem');
            const result = await client.callTool({name: 'search_ecosystem', arguments: {query: 'react'}});
            expect(result.isError).toBe(true);
            expect(textOf(result)).toContain(`Could not load the Build with MapLibre catalog from ${origin}/missing.json: Fetching ${origin}/missing.json failed with HTTP 404. The ecosystem tools need to reach it over the network.`);
        } finally {
            process.env.MAPLIBRE_MCP_CATALOG_URL = `${origin}/catalog.json`;
        }
    });
});

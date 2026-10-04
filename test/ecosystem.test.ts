import type {Server} from 'node:http';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {connect, serveJson, textOf} from './connect.js';

const catalog = {
    schemaVersion: 1,
    site: 'https://makewithmaplibre.com/',
    generatedAt: '2026-09-28T12:00:00.000Z',
    copyright: '© Birk Skyum, Make with MapLibre',
    copyrightHolder: 'Birk Skyum',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Make with MapLibre (makewithmaplibre.com), by Birk Skyum',
    attributionUrl: 'https://makewithmaplibre.com/',
    productCategories: [
        {slug: 'social-messaging', name: 'Social & Messaging', description: 'Social networks and messengers.', url: 'https://makewithmaplibre.com/products/category/social-messaging/'},
    ],
    libraries: [
        {
            slug: 'react-map-gl', name: 'React Map GL', kind: 'sdk', group: 'framework', tagline: 'React wrapper for MapLibre GL JS',
            description: 'A declarative React API for MapLibre GL JS.', link: 'https://visgl.github.io/react-map-gl/',
            url: 'https://makewithmaplibre.com/sdks/react-map-gl/', repository: 'https://github.com/visgl/react-map-gl',
            license: 'MIT', platforms: ['Web'], languages: ['JavaScript', 'TypeScript'], frameworks: ['React'], renderers: ['MapLibre GL JS'], weight: 5,
        },
        {
            slug: 'maplibre-swiftui-dsl', name: 'MapLibre SwiftUI DSL', kind: 'sdk', group: 'framework', tagline: 'SwiftUI bindings for MapLibre Native',
            description: 'Declarative SwiftUI maps.', link: 'https://github.com/maplibre/swiftui-dsl',
            url: 'https://makewithmaplibre.com/sdks/maplibre-swiftui-dsl/', platforms: ['iOS'], languages: ['Swift'],
            frameworks: ['SwiftUI'], renderers: ['MapLibre Native'], weight: 3,
        },
        {
            slug: 'maplibre-contour', name: 'maplibre-contour', kind: 'plugin', group: 'layers', tagline: 'Contour lines from elevation tiles',
            description: 'Draws contour lines on the fly.', link: 'https://github.com/onthegomap/maplibre-contour',
            url: 'https://makewithmaplibre.com/plugins/maplibre-contour/', demo: 'https://makewithmaplibre.com/plugins/maplibre-contour/#live-demo',
            platforms: ['Web'], languages: ['TypeScript'], frameworks: [], renderers: ['MapLibre GL JS'],
        },
        {
            slug: 'maplibre-agent-skills', name: 'MapLibre Agent Skills', kind: 'ai', group: 'skills', tagline: 'Guidance that helps AI assistants write MapLibre code',
            description: 'Agent skills for MapLibre GL JS.', link: 'https://github.com/maplibre/maplibre-agent-skills',
            url: 'https://makewithmaplibre.com/ai/maplibre-agent-skills/', license: 'MIT', platforms: ['Web'], languages: [], frameworks: [], renderers: ['MapLibre GL JS'],
        },
        {
            slug: 'valhalla', name: 'Valhalla', kind: 'routing', tagline: 'Open-source routing engine',
            description: 'A routing engine for OpenStreetMap data.', link: 'https://github.com/valhalla/valhalla',
            url: 'https://makewithmaplibre.com/routing/valhalla/', platforms: ['Server'], languages: ['C++'], frameworks: [], renderers: [],
        },
        {
            slug: 'maplibre-gl-directions', name: 'MapLibre GL Directions', kind: 'routing', tagline: 'Routing plugin for web maps',
            description: 'A directions control for MapLibre GL JS that adds routing to web maps.', link: 'https://github.com/maplibre/maplibre-gl-directions',
            url: 'https://makewithmaplibre.com/routing/maplibre-gl-directions/', platforms: ['Web'], languages: ['TypeScript'], frameworks: [], renderers: ['MapLibre GL JS'],
        },
        {
            slug: 'vue-maplibre', name: 'Vue MapLibre', kind: 'sdk', group: 'framework', tagline: 'Vue.js wrapper for MapLibre GL JS',
            description: 'Vue.js plugin that provides MapLibre GL JS components.', link: 'https://github.com/example/vue-maplibre',
            url: 'https://makewithmaplibre.com/sdks/vue-maplibre/', platforms: ['Web'], languages: ['TypeScript'], frameworks: ['Vue'], renderers: ['MapLibre GL JS'],
        },
    ],
    basemaps: [
        {
            slug: 'openfreemap-liberty', name: 'Liberty', type: 'style', provider: 'OpenFreeMap', description: 'A detailed OpenStreetMap basemap.',
            styleUrl: 'https://tiles.openfreemap.org/styles/liberty', free: true, url: 'https://makewithmaplibre.com/basemaps/styles/openfreemap-liberty/',
        },
        {
            slug: 'maptiler-dataviz-dark', name: 'Dataviz Dark', type: 'style', provider: 'MapTiler', description: 'A dark style for data visualization.',
            styleUrl: 'https://api.maptiler.com/maps/dataviz-dark/style.json', free: false, url: 'https://makewithmaplibre.com/basemaps/',
        },
        {
            slug: 'maptoolkit-light', name: 'Light', type: 'style', provider: 'Maptoolkit', description: 'A light, muted style.',
            styleUrl: 'https://static.maptoolkit.net/styles/toursprung/light.json', logoControl: '@maptoolkit/maplibre-logo-control', free: true,
            url: 'https://makewithmaplibre.com/basemaps/styles/maptoolkit-light/',
        },
        {
            slug: 'aws-terrarium', name: 'Terrarium Elevation', type: 'terrain', provider: 'AWS Open Data', description: 'Global elevation tiles.',
            tileUrl: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', tileSize: 256, encoding: 'terrarium',
            attribution: '<a href="https://github.com/tilezen/joerd">Mapzen Terrain Tiles</a>', free: true,
            url: 'https://makewithmaplibre.com/basemaps/styles/aws-terrarium/',
        },
    ],
    services: [
        {slug: 'stadia-routing', name: 'Stadia Maps', kind: 'routing-api', link: 'https://docs.stadiamaps.com/routing/', description: 'Hosted Valhalla routing.', sponsored: true},
    ],
    products: [
        {
            slug: 'immich', name: 'Immich', tagline: 'Self-hosted photo and video backup', description: 'Shows geotagged photos on a map.',
            maplibre: 'Its web map is built on maplibre-gl.',
            link: 'https://immich.app', url: 'https://makewithmaplibre.com/products/immich/', categories: ['social-messaging'],
            renderers: ['MapLibre GL JS'], platforms: ['Web', 'Android', 'iOS'], frameworks: [],
            uses: ['react-map-gl', 'valhalla', 'openfreemap-liberty', 'stadia-routing'], added: '2026-03-29', weight: 4,
        },
        {
            slug: 'tile-co', name: 'Tile Co', tagline: 'Maps API', description: 'Map tiles and APIs.', link: 'https://tile.example',
            url: 'https://makewithmaplibre.com/products/tile-co/', categories: ['social-messaging'], renderers: ['MapLibre GL JS'], platforms: ['Web'],
            frameworks: [], uses: [], offers: ['Vector map tiles with MapLibre styles', 'Geocoding and reverse geocoding API'], added: '2026-09-30',
        },
    ],
    makers: [
        {slug: 'geoagency', name: 'Geo Agency', link: 'https://geo.example', description: 'Builds MapLibre apps for clients.', consultancy: true, url: 'https://makewithmaplibre.com/makers/geoagency/'},
    ],
};

/** The catalog as it was before it carried a license. */
const unlicensed = Object.fromEntries(Object.entries(catalog).filter(([key]) => !/^(copyright|license|attribution)/.test(key)));

describe('ecosystem', () => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        ({server, origin} = await serveJson({'/catalog.json': catalog, '/unlicensed.json': unlicensed, '/v2.json': {...catalog, schemaVersion: 2}}));
        process.env.MAPLIBRE_MCP_CATALOG_URL = `${origin}/catalog.json`;
    });

    afterAll(() => {
        delete process.env.MAPLIBRE_MCP_CATALOG_URL;
        server.close();
    });

    test('finds an SDK by framework, with its links and page', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'react'}}));
        expect(text).toContain('React Map GL (sdk, framework): React wrapper for MapLibre GL JS');
        expect(text).toContain('  Web · React · JavaScript, TypeScript · MapLibre GL JS · MIT');
        expect(text).toContain('  https://visgl.github.io/react-map-gl/, repository https://github.com/visgl/react-map-gl');
        expect(text).toContain('  More: https://makewithmaplibre.com/sdks/react-map-gl/');
    });

    test('credits the catalog as its license asks', async () => {
        const client = await connect('ecosystem');
        const search = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'react'}}));
        const credit = 'Source: Make with MapLibre (makewithmaplibre.com), by Birk Skyum, CC BY 4.0, generated 2026-09-28. Credit it and link to https://makewithmaplibre.com/ when you pass this on.';
        expect(search).toContain(credit);
        expect(textOf(await client.callTool({name: 'find_basemaps', arguments: {}}))).toContain(credit);
    });

    test('says where a catalog without a license comes from', async () => {
        process.env.MAPLIBRE_MCP_CATALOG_URL = `${origin}/unlicensed.json`;
        try {
            const client = await connect('ecosystem');
            const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'react'}}));
            expect(text).toContain('From https://makewithmaplibre.com/catalog.json, generated 2026-09-28.');
        } finally {
            process.env.MAPLIBRE_MCP_CATALOG_URL = `${origin}/catalog.json`;
        }
    });

    test('links the live demo of a plugin', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'contour'}}));
        expect(text).toContain('maplibre-contour (plugin, layers): Contour lines from elevation tiles');
        expect(text).toContain('  Live demo: https://makewithmaplibre.com/plugins/maplibre-contour/#live-demo');
    });

    test('filters by platform', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {kind: 'sdk', platform: 'iOS'}}));
        expect(text).toContain('1 entry matches kind sdk, platform iOS:');
        expect(text).toContain('MapLibre SwiftUI DSL (sdk, framework)');
        expect(text).not.toContain('React Map GL');
    });

    test('includes the hosted services of a kind, and discloses sponsored listings', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {kind: 'routing'}}));
        expect(text).toContain('Valhalla (routing): Open-source routing engine');
        expect(text).toContain('Stadia Maps (hosted routing API): Hosted Valhalla routing.');
        expect(text).toContain('  https://docs.stadiamaps.com/routing/ (a sponsored listing on Make with MapLibre)');
    });

    test('says what a product is built with, and its category, by name', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'valhalla', kind: 'product'}}));
        expect(text).toContain('Immich (product): Self-hosted photo and video backup');
        expect(text).toContain('  Social & Messaging · MapLibre GL JS · Web, Android, iOS · built with React Map GL, Valhalla, Liberty by OpenFreeMap, Stadia Maps');
        expect(text).toContain('  MapLibre: Its web map is built on maplibre-gl.');
        expect(text).toContain('  Map: https://immich.app');
    });

    test('finds AI tools for MapLibre', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {kind: 'ai'}}));
        expect(text).toContain('1 entry matches kind ai:');
        expect(text).toContain('MapLibre Agent Skills (ai, skills): Guidance that helps AI assistants write MapLibre code');
    });

    test('finds products by what they offer map makers', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'geocoding', kind: 'product'}}));
        expect(text).toContain('Tile Co (product): Maps API');
        expect(text).toContain('  Offers map makers: Vector map tiles with MapLibre styles; Geocoding and reverse geocoding API');
    });

    test('finds consultancies', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {kind: 'consultant'}}));
        expect(text).toContain('Geo Agency (consultancy): Builds MapLibre apps for clients.');
    });

    test('counts the GL JS controls for routing and geocoding as plugins', async () => {
        const client = await connect('ecosystem');
        const routing = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'routing', kind: 'plugin', platform: 'Web'}}));
        expect(routing).toContain('1 entry matches "routing", kind plugin, platform Web:');
        expect(routing).toContain('MapLibre GL Directions (routing): Routing plugin for web maps');
        const plugins = textOf(await client.callTool({name: 'search_ecosystem', arguments: {kind: 'plugin'}}));
        expect(plugins).toContain('maplibre-contour (plugin, layers)');
        expect(plugins).not.toContain('Vue MapLibre');
    });

    test('counts the results of each kind, and lists libraries and services before products', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'valhalla'}}));
        expect(text).toContain('3 entries match "valhalla" (1 routing library, 1 hosted service and 1 product):');
        expect(text.indexOf('Valhalla (routing)')).toBeLessThan(text.indexOf('Stadia Maps (hosted routing API)'));
        expect(text.indexOf('Stadia Maps (hosted routing API)')).toBeLessThan(text.indexOf('Immich (product)'));
        const sdks = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'swiftui'}}));
        expect(sdks).toContain('1 entry matches "swiftui":');
    });

    test('says which other kinds match when a kind leaves nothing', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'contour', kind: 'sdk'}}));
        expect(text).toContain('Nothing in Make with MapLibre matches "contour", kind sdk. Without the kind, 1 plugin matches.');
    });

    test('points to find_basemaps when basemaps match the words', async () => {
        const client = await connect('ecosystem');
        const dark = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'dark'}}));
        expect(dark).toContain('Nothing in Make with MapLibre matches "dark". Try fewer or broader words, or another kind.');
        expect(dark).toContain('1 basemap matches too. find_basemaps lists it with its style or tile URL.');
        const routing = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'dark', kind: 'routing'}}));
        expect(routing).not.toContain('find_basemaps');
    });

    test('says when nothing matches', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'search_ecosystem', arguments: {query: 'cobol'}}));
        expect(text).toContain('Nothing in Make with MapLibre matches "cobol". Try fewer or broader words, or another kind.');
    });

    test('lists free basemaps with their style URLs first', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'find_basemaps', arguments: {}}));
        expect(text.indexOf('Liberty by OpenFreeMap, free, no API key')).toBeLessThan(text.indexOf('Dataviz Dark by MapTiler, needs an API key'));
        expect(text).toContain('  Style URL: https://tiles.openfreemap.org/styles/liberty');
        expect(text).toContain('fail until the provider\'s key is added to them.');
    });

    test('says how to add elevation tiles, and the credit they need', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'find_basemaps', arguments: {query: 'elevation'}}));
        expect(text).toContain('  Source for a style: {"type":"raster-dem","tiles":["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],"tileSize":256,"encoding":"terrarium","attribution":"<a href=\\"https://github.com/tilezen/joerd\\">Mapzen Terrain Tiles</a>"}');
    });

    test('says when a provider requires its logo on the map', async () => {
        const client = await connect('ecosystem');
        const text = textOf(await client.callTool({name: 'find_basemaps', arguments: {query: 'maptoolkit'}}));
        expect(text).toContain('  Maptoolkit\'s terms require its logo on the map: add the control from the npm package @maptoolkit/maplibre-logo-control.');
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
            expect(textOf(result)).toContain(`Could not load the Make with MapLibre catalog from ${origin}/missing.json: Fetching ${origin}/missing.json failed with HTTP 404. The ecosystem tools need to reach it over the network.`);
        } finally {
            process.env.MAPLIBRE_MCP_CATALOG_URL = `${origin}/catalog.json`;
        }
    });
});

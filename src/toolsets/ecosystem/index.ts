import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import type {Toolset} from '../../toolsets.js';
import {type Basemap, type Catalog, type Library, loadCatalog, type Product, type ServiceKind} from './catalog.js';

export const ecosystemToolset: Toolset = {
    name: 'ecosystem',
    description: 'Search Make with MapLibre for SDKs, plugins, services, products and basemaps',
    instructions: [
        'search_ecosystem finds the plugins and services that add what MapLibre itself does not have, like contour lines, drawing, routing and geocoding.',
        'find_basemaps lists basemap styles, tiles and elevation data, and says which need an API key.',
    ].join(' '),
    register(server) {
        registerSearchEcosystem(server);
        registerFindBasemaps(server);
    },
};

const KINDS = ['sdk', 'plugin', 'routing', 'geocoding', 'styling', 'tiling', 'ai', 'service', 'product', 'consultant'] as const;
type Kind = (typeof KINDS)[number];

const PLATFORMS = ['Web', 'iOS', 'Android', 'Desktop', 'Server'] as const;

/** What one entry and several entries of each kind are called, to count the results by kind. */
const KIND_NAMES: Record<Kind, [string, string]> = {
    sdk: ['SDK', 'SDKs'],
    plugin: ['plugin', 'plugins'],
    routing: ['routing library', 'routing libraries'],
    geocoding: ['geocoding library', 'geocoding libraries'],
    styling: ['styling tool', 'styling tools'],
    tiling: ['tiling tool', 'tiling tools'],
    ai: ['AI tool', 'AI tools'],
    service: ['hosted service', 'hosted services'],
    product: ['product', 'products'],
    consultant: ['consultancy', 'consultancies'],
};

const SERVICE_LABEL: Record<ServiceKind, string> = {
    'routing-api': 'routing API',
    'geocoding-api': 'geocoding API',
    'style-editor': 'style editor',
    'tile-host': 'tile hosting',
};

/** The hosted services that a library kind includes, like the pages of Make with MapLibre do. */
const SERVICES_OF_KIND: Partial<Record<Kind, ServiceKind>> = {
    'routing': 'routing-api',
    'geocoding': 'geocoding-api',
    'styling': 'style-editor',
    'tiling': 'tile-host',
};

type Entry = {
    kinds: Kind[];
    name: string;
    weight: number;
    platforms: string[];
    text: string;
    lines: string[];
};

function registerSearchEcosystem(server: McpServer): void {
    server.registerTool('search_ecosystem', {
        title: 'Search the MapLibre ecosystem',
        description: [
            'Searches Make with MapLibre (makewithmaplibre.com), a curated directory of what works with MapLibre:',
            'SDKs and framework bindings, GL JS plugins, routing and navigation, geocoding, styling and tiling tools, AI tools (MCP servers and agent skills),',
            'hosted APIs, the products built with MapLibre, and consultancies. Use it to pick an SDK for a platform',
            'or framework, find a plugin or a service, find a platform or data source to build on, or see which products use a library. Each result has its',
            'links and a page with more. Follow up with find_basemaps for style URLs to render.',
        ].join(' '),
        inputSchema: z.object({
            query: z.string().optional().describe('Words that each result has to contain, like "react", "draw" or "routing". Leave it out to list the most prominent entries.'),
            kind: z.enum(KINDS).optional().describe('Only entries of this kind. ai is MCP servers and agent skills for MapLibre. plugin includes the routing and geocoding controls for MapLibre GL JS. routing, geocoding, styling and tiling include the hosted services of that kind, and service lists all of them.'),
            platform: z.enum(PLATFORMS).optional().describe('Only entries that run on this platform. Hosted services and consultancies have no platform and are kept.'),
            limit: z.number().int().min(1).max(50).default(10).describe('The most results to return.'),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({query, kind, platform, limit}) => {
        const catalog = await loadCatalog();
        const terms = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const found = entries(catalog)
            .filter(entry => !platform || entry.platforms.length === 0 || entry.platforms.includes(platform))
            .filter(entry => terms.every(term => entry.text.includes(term)))
            .sort((a, b) => score(b, terms) - score(a, terms) || tier(a) - tier(b) || b.weight - a.weight || a.name.localeCompare(b.name));
        const matches = found.filter(entry => !kind || entry.kinds.includes(kind));
        const shown = matches.slice(0, limit);
        const lines: string[] = [];
        if (shown.length > 0) {
            const kinds = kind || new Set(matches.map(entry => entry.kinds[0])).size < 2 ? '' : ` (${describeKinds(matches)})`;
            lines.push(
                `${matches.length} ${matches.length === 1 ? 'entry matches' : 'entries match'}${describeSearch(query, kind, platform)}${kinds}${matches.length > shown.length ? `, the first ${shown.length} here` : ''}:`,
                ...shown.flatMap(entry => ['', ...entry.lines]),
            );
        } else if (found.length > 0) {
            lines.push(`Nothing in Make with MapLibre matches${describeSearch(query, kind, platform)}. Without the kind, ${describeKinds(found)} ${found.length === 1 ? 'matches' : 'match'}.`);
        } else {
            lines.push(`Nothing in Make with MapLibre matches${describeSearch(query, kind, platform)}. Try fewer or broader words, or another kind.`);
        }
        const basemaps = terms.length > 0 && (!kind || kind === 'styling' || kind === 'tiling') ?
            catalog.basemaps.filter(basemap => basemapMatches(basemap, terms)).length :
            0;
        if (basemaps > 0) {
            lines.push('', `${basemaps} ${basemaps === 1 ? 'basemap matches' : 'basemaps match'} too. find_basemaps lists ${basemaps === 1 ? 'it with its style or tile URL' : 'them with their style or tile URLs'}.`);
        }
        lines.push('', sourceLine(catalog));
        return {content: [{type: 'text', text: lines.join('\n')}]};
    });
}

function registerFindBasemaps(server: McpServer): void {
    server.registerTool('find_basemaps', {
        title: 'Find basemaps',
        description: [
            'Lists the basemaps in Make with MapLibre (makewithmaplibre.com): ready-made MapLibre styles from',
            'OpenFreeMap, Protomaps, MapTiler, Stadia Maps, VersaTiles and others, with their style URLs and whether they need an',
            'API key, plus raster and elevation tiles. Pass a style URL as url to render_style or compare_styles to see it,',
            'or start a style from it.',
        ].join(' '),
        inputSchema: z.object({
            query: z.string().optional().describe('Words that each basemap has to contain, in its name, provider or description, like "dark", "satellite" or "openfreemap".'),
            free: z.boolean().optional().describe('true for only the basemaps that need no API key, false for only those that do.'),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({query, free}) => {
        const catalog = await loadCatalog();
        const terms = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const basemaps = catalog.basemaps
            .filter(basemap => free === undefined || basemap.free === free)
            .filter(basemap => basemapMatches(basemap, terms))
            .sort((a, b) => Number(b.free) - Number(a.free) || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
        const lines = basemaps.length === 0 ?
            ['No basemap in Make with MapLibre matches. Try fewer words, or leave out free.'] :
            basemaps.flatMap(basemap => ['', `${basemap.name} by ${basemap.provider}, ${basemap.free ? 'free, no API key' : 'needs an API key'}: ${basemap.description}`, ...basemapSetup(basemap), `  More: ${basemap.url}`]);
        if (basemaps.some(basemap => !basemap.free)) {
            lines.push('', 'The style URLs of basemaps that need an API key fail until the provider\'s key is added to them.');
        }
        lines.push('', sourceLine(catalog));
        return {content: [{type: 'text', text: lines.join('\n').replace(/^\n/, '')}]};
    });
}

function entries(catalog: Catalog): Entry[] {
    // A product's uses lists the slugs of libraries, basemaps and services, which the catalog keeps unique across all three.
    const usedNames = new Map([
        ...catalog.libraries.map(library => [library.slug, library.name] as const),
        ...catalog.basemaps.map(basemap => [basemap.slug, `${basemap.name} by ${basemap.provider}`] as const),
        ...catalog.services.map(service => [service.slug, service.name] as const),
    ]);
    const categoryNames = new Map(catalog.productCategories.map(category => [category.slug, category.name]));
    const makerNames = new Map(catalog.makers.map(maker => [maker.slug, maker.name]));
    return [
        ...catalog.libraries.map(library => libraryEntry(library, makerNames)),
        ...catalog.services.map((service): Entry => {
            const kinds = Object.entries(SERVICES_OF_KIND).filter(([, serviceKind]) => serviceKind === service.kind).map(([kind]) => kind as Kind);
            const about = [service.description, service.note].filter(Boolean).join(' ');
            return {
                kinds: ['service', ...kinds],
                name: service.name,
                weight: 0,
                platforms: [],
                text: searchText(service.name, SERVICE_LABEL[service.kind], about, makerNames.get(service.maker ?? '')),
                lines: [
                    `${service.name} (hosted ${SERVICE_LABEL[service.kind]})${about ? `: ${about}` : ''}`,
                    `  ${service.link}${service.sponsored ? ' (a sponsored listing on Make with MapLibre)' : ''}`,
                ],
            };
        }),
        ...catalog.products.map(product => productEntry(product, usedNames, categoryNames, makerNames)),
        ...catalog.makers.filter(maker => maker.consultancy).map((maker): Entry => ({
            kinds: ['consultant'],
            name: maker.name,
            weight: 0,
            platforms: [],
            text: searchText(maker.name, 'consultant consultancy agency', maker.description),
            lines: [`${maker.name} (consultancy)${maker.description ? `: ${maker.description}` : ''}`, `  ${maker.link}`, `  More: ${maker.url}`],
        })),
    ];
}

function libraryEntry(library: Library, makerNames: Map<string, string>): Entry {
    const facts = [library.platforms, library.frameworks, library.languages, library.renderers]
        .map(list => list.join(', '))
        .concat(library.license ?? [])
        .filter(Boolean);
    const links = [
        library.link,
        library.repository && library.repository !== library.link ? `repository ${library.repository}` : undefined,
        library.documentation && library.documentation !== library.link ? `docs ${library.documentation}` : undefined,
        library.npm ? `npm ${library.npm}` : undefined,
    ].filter(Boolean);
    return {
        kinds: addsGlJsControl(library) ? [library.kind, 'plugin'] : [library.kind],
        name: library.name,
        weight: library.weight ?? 0,
        platforms: library.platforms,
        text: searchText(library.name, library.kind, library.group, library.tagline, library.description, ...library.platforms, ...library.frameworks, ...library.languages, ...library.renderers, makerNames.get(library.maker ?? '')),
        lines: [
            `${library.name} (${[library.kind, library.group].filter(Boolean).join(', ')})${library.tagline ? `: ${library.tagline}` : ''}`,
            `  ${library.description}`,
            ...(facts.length > 0 ? [`  ${facts.join(' · ')}`] : []),
            `  ${links.join(', ')}`,
            ...(library.demo ? [`  Live demo: ${library.demo}`] : []),
            `  More: ${library.url}`,
        ],
    };
}

function productEntry(product: Product, usedNames: Map<string, string>, categoryNames: Map<string, string>, makerNames: Map<string, string>): Entry {
    const builtWith = product.uses.map(slug => usedNames.get(slug) ?? slug);
    const categories = product.categories.map(slug => categoryNames.get(slug) ?? slug);
    const facts = [categories, product.renderers, product.platforms].map(list => list.join(', ')).filter(Boolean);
    return {
        kinds: ['product'],
        name: product.name,
        weight: product.weight ?? 0,
        platforms: product.platforms,
        text: searchText(product.name, 'product', product.tagline, product.description, product.maplibre, ...(product.offers ?? []), ...categories, ...product.renderers, ...product.platforms, ...product.frameworks, ...builtWith, makerNames.get(product.maker ?? '')),
        lines: [
            `${product.name} (product)${product.tagline ? `: ${product.tagline}` : ''}`,
            `  ${product.description}`,
            ...(product.maplibre ? [`  MapLibre: ${product.maplibre}`] : []),
            ...(product.offers ? [`  Offers map makers: ${product.offers.join('; ')}`] : []),
            `  ${facts.join(' · ')}${builtWith.length > 0 ? ` · built with ${builtWith.join(', ')}` : ''}`,
            `  Map: ${product.link}`,
            `  More: ${product.url}`,
        ],
    };
}

/** How to put a basemap on a map, with what the provider requires the map to show. */
function basemapSetup(basemap: Basemap): string[] {
    const lines = basemap.styleUrl ?
        [`  Style URL: ${basemap.styleUrl}`] :
        [
            // MapLibre assumes 512 pixel tiles, so a source of 256 pixel tiles has to say so.
            `  Tiles, to add as a ${basemap.encoding ? 'raster-dem' : 'raster'} source with tileSize ${basemap.tileSize ?? 256}: ${[basemap.tileUrl ?? []].flat().join(', ')}`,
            ...(basemap.encoding ? [`  Elevation encoding: ${basemap.encoding}`] : []),
        ];
    if (basemap.attribution) lines.push(`  Attribution the map has to show: ${basemap.attribution}`);
    if (basemap.logoControl) lines.push(`  ${basemap.provider}'s terms require its logo on the map: add the control from the npm package ${basemap.logoControl}.`);
    return lines;
}

/** Where the results come from, with the credit that the catalog's license asks for when they are passed on. */
function sourceLine(catalog: Catalog): string {
    const generated = catalog.generatedAt.slice(0, 10);
    if (!catalog.attribution) return `From ${new URL('catalog.json', catalog.site).href}, generated ${generated}.`;
    const license = catalog.license?.startsWith('CC-') ? catalog.license.replaceAll('-', ' ') : catalog.license;
    return `Source: ${catalog.attribution}${license ? `, ${license}` : ''}, generated ${generated}. Credit it and link to ${catalog.attributionUrl ?? catalog.site} when you pass this on.`;
}

/** Routing and geocoding libraries that add a control to a MapLibre GL JS map, like MapLibre GL Directions, are GL JS plugins too. */
function addsGlJsControl(library: Library): boolean {
    return (library.kind === 'routing' || library.kind === 'geocoding') &&
        library.platforms.includes('Web') &&
        library.renderers.includes('MapLibre GL JS') &&
        /\b(plugin|control)\b/i.test(`${library.tagline ?? ''} ${library.description}`);
}

function basemapMatches(basemap: Basemap, terms: string[]): boolean {
    const text = `${basemap.name} ${basemap.provider} ${basemap.description}`.toLowerCase();
    return terms.every(term => text.includes(term));
}

/** Libraries and hosted services come before products and consultancies, which outnumber them and mention the same words. */
function tier(entry: Entry): number {
    return entry.kinds[0] === 'product' || entry.kinds[0] === 'consultant' ? 1 : 0;
}

/** Counts entries by their kind, the largest group first, like "25 products, 4 plugins and 1 routing library". */
function describeKinds(entries: Entry[]): string {
    const counts = new Map<Kind, number>();
    for (const entry of entries) counts.set(entry.kinds[0], (counts.get(entry.kinds[0]) ?? 0) + 1);
    const parts = [...counts]
        .sort(([kindA, countA], [kindB, countB]) => countB - countA || KINDS.indexOf(kindA) - KINDS.indexOf(kindB))
        .map(([kind, count]) => `${count} ${KIND_NAMES[kind][count === 1 ? 0 : 1]}`);
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function searchText(...parts: Array<string | undefined>): string {
    return parts.filter(Boolean).join(' ').toLowerCase();
}

/** Ranks entries whose name has the search words above those that only mention them. */
function score(entry: Entry, terms: string[]): number {
    const name = entry.name.toLowerCase();
    return terms.filter(term => name.includes(term)).length * 10 + (terms.length > 0 && name === terms.join(' ') ? 100 : 0);
}

function describeSearch(query: string | undefined, kind: Kind | undefined, platform: string | undefined): string {
    const parts = [query && `"${query}"`, kind && `kind ${kind}`, platform && `platform ${platform}`].filter(Boolean);
    return parts.length > 0 ? ` ${parts.join(', ')}` : '';
}

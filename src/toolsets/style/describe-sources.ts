import type {LayerSpecification, SourceSpecification, StyleSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {McpServer} from '@modelcontextprotocol/server';
import {PMTiles} from 'pmtiles';
import {z} from 'zod';
import {fetchJson, loadStyle, STYLE_INPUT} from '../../style-input.js';

type VectorLayer = {id: string; fields?: Record<string, string>};

type TileJson = {
    tiles?: string[];
    minzoom?: number;
    maxzoom?: number;
    tileSize?: number;
    vector_layers?: VectorLayer[];
};

type GeoJson = {
    type?: string;
    features?: GeoJson[];
    geometry?: GeoJson | null;
    geometries?: GeoJson[];
    properties?: Record<string, unknown> | null;
};

/** What the metadata of a source says about it. */
type SourceInfo = {
    lines: string[];
    /**
     * The fields of each source layer of a vector source. A GeoJSON source has a single layer, keyed by the
     * empty string. Undefined when the metadata does not tell.
     */
    layers?: Record<string, string[]>;
};

const LEGACY_FILTER_OPERATORS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', '!in', 'has', '!has']);
const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const TOKEN_PROPERTIES = new Set(['text-field', 'icon-image']);

export function registerDescribeSources(server: McpServer): void {
    server.registerTool('describe_sources', {
        title: 'Describe sources',
        description: [
            'Reads the metadata of every source in a MapLibre style (TileJSON, PMTiles headers and GeoJSON data)',
            'and lists the source layers and fields each one provides. Then checks that every layer uses a source,',
            'source layer and fields that exist. Use it before writing layers against data you do not know,',
            'and when a layer draws nothing. Pass the style as an object, a URL or a file path.',
        ].join(' '),
        inputSchema: z.object(STYLE_INPUT),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async input => {
        const style = await loadStyle(input);
        const infos: Record<string, SourceInfo> = {};
        await Promise.all(Object.entries(style.sources).map(async ([id, source]) => {
            infos[id] = await describeSource(source).catch(error => ({lines: [`Could not read the metadata: ${error.message}`]}));
        }));
        return {content: [{type: 'text', text: report(style, infos)}]};
    });
}

function report(style: StyleSpecification, infos: Record<string, SourceInfo>): string {
    const lines = ['Sources:'];
    for (const [id, source] of Object.entries(style.sources)) {
        const users = style.layers.filter(layer => 'source' in layer && layer.source === id).length;
        lines.push(`${id} (${source.type}), used by ${users} ${users === 1 ? "layer" : "layers"}`, ...infos[id].lines.map(line => `  ${line}`));
    }
    const problems = style.layers.flatMap(layer => checkLayer(layer, style, infos));
    lines.push('', problems.length > 0 ? 'Problems:' : 'Every layer uses a source, source layer and fields that exist.');
    lines.push(...problems.map(problem => `  ${problem}`));
    return lines.join('\n');
}

async function describeSource(source: SourceSpecification): Promise<SourceInfo> {
    switch (source.type) {
        case 'vector':
        case 'raster':
        case 'raster-dem':
            if (source.url?.startsWith('pmtiles://')) return describePmtiles(source.url.slice('pmtiles://'.length));
            if (source.url) return describeTileJson(source.url, await fetchJson<TileJson>(source.url));
            return {lines: [`Tiles: ${source.tiles?.join(', ')}`, 'The tiles are listed in the style, so there is no metadata to read.']};
        case 'geojson':
            if (typeof source.data === 'string') return describeGeoJson(source.data, await fetchJson<GeoJson>(source.data));
            return describeGeoJson('inline data', source.data);
        case 'image':
            return {lines: [`URL: ${source.url}`]};
        case 'video':
            return {lines: [`URLs: ${source.urls.join(', ')}`]};
    }
}

function describeTileJson(url: string, tileJson: TileJson): SourceInfo {
    const lines = [`TileJSON: ${url}`, `Zoom ${tileJson.minzoom ?? 0} to ${tileJson.maxzoom ?? 22}.`];
    if (tileJson.tileSize) lines.push(`Tile size ${tileJson.tileSize}.`);
    return withVectorLayers(lines, tileJson.vector_layers);
}

async function describePmtiles(url: string): Promise<SourceInfo> {
    const archive = new PMTiles(url);
    const [header, metadata] = await Promise.all([archive.getHeader(), archive.getMetadata()]);
    const lines = [`PMTiles: ${url}`, `Zoom ${header.minZoom} to ${header.maxZoom}.`];
    const vectorLayers = typeof metadata === 'object' && metadata !== null && 'vector_layers' in metadata ?
        metadata.vector_layers : undefined;
    return withVectorLayers(lines, Array.isArray(vectorLayers) ? vectorLayers : undefined);
}

function withVectorLayers(lines: string[], vectorLayers: VectorLayer[] | undefined): SourceInfo {
    if (!vectorLayers) return {lines};
    const layers = Object.fromEntries(vectorLayers.map(layer => [layer.id, Object.keys(layer.fields ?? {})]));
    lines.push('Source layers and their fields:', ...Object.entries(layers).map(([id, fields]) => `  ${id}: ${summarizeFields(fields)}`));
    return {lines, layers};
}

function describeGeoJson(origin: string, data: GeoJson): SourceInfo {
    const features = collectFeatures(data);
    const geometryTypes = [...new Set(features.map(feature => feature.geometry?.type ?? 'none'))];
    const fields = [...new Set(features.flatMap(feature => Object.keys(feature.properties ?? {})))];
    return {
        lines: [
            `GeoJSON: ${origin}`,
            `${features.length} ${features.length === 1 ? 'feature' : 'features'} with ${geometryTypes.join(', ')} geometry.`,
            `Fields: ${summarizeFields(fields)}`,
        ],
        layers: {'': fields},
    };
}

function collectFeatures(data: GeoJson): GeoJson[] {
    if (data.type === 'FeatureCollection') return data.features ?? [];
    if (data.type === 'Feature') return [data];
    return [{type: 'Feature', geometry: data, properties: {}}];
}

/**
 * Lists fields, and folds families like `name:de, name:fr, ...` or `route_1_ref, route_2_ref, ...` into one
 * entry, since a source layer can have hundreds of them.
 */
function summarizeFields(fields: string[]): string {
    if (fields.length === 0) return '(none listed)';
    const families = new Map<string, string[]>();
    for (const field of fields) {
        const family = field.includes('name:') ? field.replace(/name:.*$/, 'name:*') : field.replace(/\d+/g, '*');
        families.set(family, [...families.get(family) ?? [], field]);
    }
    return [...families]
        .flatMap(([family, members]) => members.length > 3 && family.includes('*') ? [`${family} (${members.length} fields)`] : members)
        .join(', ');
}

function checkLayer(layer: LayerSpecification, style: StyleSpecification, infos: Record<string, SourceInfo>): string[] {
    if (!('source' in layer)) return [];
    const source = style.sources[layer.source];
    if (!source) return [`Layer "${layer.id}" uses the source "${layer.source}", which the style does not define.`];

    const layers = infos[layer.source]?.layers;
    if (!layers) return [];
    const sourceLayer = source.type === 'vector' && 'source-layer' in layer ? layer['source-layer'] : '';
    if (source.type === 'vector' && !sourceLayer) return [`Layer "${layer.id}" has no source-layer, which a vector source needs.`];

    const fields = layers[sourceLayer ?? ''];
    if (!fields) {
        const available = Object.keys(layers).join(', ');
        return [`Layer "${layer.id}" uses the source layer "${sourceLayer}", which "${layer.source}" does not have. It has: ${available}.`];
    }
    if (fields.length === 0) return [];
    return [...fieldsUsedBy(layer)]
        .filter(field => !fields.includes(field) && !(field.startsWith('name:') && fields.includes('name')))
        .map(field => `Layer "${layer.id}" reads the field "${field}", which "${layer.source}" does not list${sourceLayer ? ` for "${sourceLayer}"` : ''}.`);
}

function fieldsUsedBy(layer: LayerSpecification): Set<string> {
    const fields = new Set<string>();
    if ('filter' in layer) collectFields(layer.filter, fields, true);
    for (const [property, value] of [...Object.entries(layer.layout ?? {}), ...Object.entries('paint' in layer ? layer.paint ?? {} : {})]) {
        collectFields(value, fields, false);
        if (TOKEN_PROPERTIES.has(property) && typeof value === 'string') {
            for (const [, token] of value.matchAll(/\{([^}]+)\}/g)) fields.add(token);
        }
    }
    return fields;
}

/** Adds the fields that an expression, legacy filter or legacy function reads. */
function collectFields(value: unknown, fields: Set<string>, isFilter: boolean): void {
    if (Array.isArray(value)) {
        const field = getField(value) ?? (isFilter ? legacyFilterField(value) : undefined);
        if (field && !field.startsWith('$')) fields.add(field);
        for (const item of value) collectFields(item, fields, isFilter);
        return;
    }
    if (typeof value !== 'object' || value === null) return;
    if ('property' in value && typeof value.property === 'string') fields.add(value.property);
    for (const item of Object.values(value)) collectFields(item, fields, isFilter);
}

function getField([operator, field, ...rest]: unknown[]): string | undefined {
    const reads = (operator === 'get' || operator === 'has') && rest.length === 0;
    return reads && typeof field === 'string' ? field : undefined;
}

function legacyFilterField([operator, key, value]: unknown[]): string | undefined {
    if (typeof operator !== 'string' || !LEGACY_FILTER_OPERATORS.has(operator) || typeof key !== 'string') return undefined;
    const isExpression = Array.isArray(value) && (operator === 'in' || COMPARISON_OPERATORS.has(operator));
    return isExpression ? undefined : key;
}

import {VectorTile, VectorTileFeature} from '@mapbox/vector-tile';
import type {SourceSpecification, StyleSpecification} from '@maplibre/maplibre-gl-style-spec';
import {decodeTile, GEOMETRY_TYPE} from '@maplibre/mlt';
import type {McpServer} from '@modelcontextprotocol/server';
import {open} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {PbfReader} from 'pbf';
import {PMTiles, type Source, TileType} from 'pmtiles';
import {z} from 'zod';
import {mercatorX, mercatorY} from '../../render-style.js';
import {checkFileAccess, fetchJson, loadStyle, STYLE_INPUT, type StyleInput} from '../../style-input.js';
import {fieldFamilies, isFolded, type TileJson} from './describe-sources.js';

type Encoding = 'mvt' | 'mlt';

/** A source of vector tiles, whether a style names it or it is given by its URL. */
type TileSource = {
    /** How the report names the source, like its TileJSON URL. */
    name: string;
    minzoom: number;
    maxzoom: number;
    /** `[longitude, latitude, zoom]` to read when the caller gives no place. */
    center?: number[];
    tms: boolean;
    encoding?: Encoding;
    getTile: (z: number, x: number, y: number) => Promise<Uint8Array | undefined>;
};

type Feature = {geometryType: string; properties: Record<string, unknown>};

type InspectInput = StyleInput & {source?: string; center?: number[]; zoom?: number; layer?: string; examples?: number};

/** How often each value of a field occurs, keyed by the value as the report writes it. */
type FieldValues = {features: number; values: Map<string, number>};

const DEFAULT_EXAMPLES = 3;
/** Beyond this many different values, a field shows a few of them rather than all. */
const MAX_LISTED_VALUES = 12;
const RASTER_TILE_TYPES = new Set([TileType.Png, TileType.Jpeg, TileType.Webp, TileType.Avif]);

/** MapLibre's `geometry-type` reports multi-geometries by their simple type, and so does the report. */
const MLT_GEOMETRY_TYPES: Record<GEOMETRY_TYPE, string> = {
    [GEOMETRY_TYPE.POINT]: 'Point',
    [GEOMETRY_TYPE.MULTIPOINT]: 'Point',
    [GEOMETRY_TYPE.LINESTRING]: 'LineString',
    [GEOMETRY_TYPE.MULTILINESTRING]: 'LineString',
    [GEOMETRY_TYPE.POLYGON]: 'Polygon',
    [GEOMETRY_TYPE.MULTIPOLYGON]: 'Polygon',
};

export function registerInspectTile(server: McpServer): void {
    server.registerTool('inspect_tile', {
        title: 'Inspect tile',
        description: [
            'Reads the vector tile of a source at a place and zoom, and lists each source layer with its number of features,',
            'their geometry types, the values of each field and a few example features. Use it to learn the values data',
            'really has, like the classes of roads, before writing filters and expressions. The source is either the id of',
            'a source in the style you pass, or the URL of a vector source: a TileJSON URL like a Martin source, a PMTiles',
            'archive, or a tile URL with {z}, {x} and {y}. Reads MVT and MLT tiles.',
        ].join(' '),
        inputSchema: z.object({
            ...STYLE_INPUT,
            source: z.string().optional()
                .describe('The id of a source in the style, or the URL of a vector source. Defaults to the only vector source of the style.'),
            center: z.array(z.number()).length(2).optional()
                .describe('[longitude, latitude] of the place to read. Defaults to the center of the style or the source.'),
            zoom: z.number().min(0).max(24).optional()
                .describe('Zoom level of the tile. Defaults to the zoom of the style, or the highest zoom of the source.'),
            layer: z.string().optional().describe('Only list this source layer.'),
            examples: z.number().int().min(0).max(20).optional()
                .describe(`How many example features to show for each source layer. Defaults to ${DEFAULT_EXAMPLES}.`),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async input => {
        const {source, style} = await openSource(input);
        return {content: [{type: 'text', text: await inspect(source, style, input)}]};
    });
}

/** Returns the source to read, given by its URL or by its id in a style, and the style when there is one. */
async function openSource(input: InspectInput): Promise<{source: TileSource; style?: StyleSpecification}> {
    if (input.source !== undefined && isLocation(input.source)) return {source: await openLocation(input.source)};
    if (input.style === undefined && input.url === undefined && input.path === undefined) {
        throw new Error('Pass the URL of a vector source as source, or a style and the id of one of its sources.');
    }
    const style = await loadStyle(input);
    const id = input.source ?? onlyVectorSource(style);
    const source = style.sources[id];
    if (!source) throw new Error(`The style has no source "${id}". Its sources are: ${Object.keys(style.sources).join(', ')}.`);
    return {source: await openStyleSource(id, source), style};
}

function isLocation(source: string): boolean {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(source) || source.endsWith('.pmtiles');
}

function onlyVectorSource(style: StyleSpecification): string {
    const ids = Object.entries(style.sources).filter(([, source]) => source.type === 'vector').map(([id]) => id);
    if (ids.length !== 1) {
        throw new Error(`The style has ${ids.length} vector sources, so pass the id of one as source: ${ids.join(', ')}.`);
    }
    return ids[0];
}

async function openStyleSource(id: string, source: SourceSpecification): Promise<TileSource> {
    if (source.type !== 'vector') {
        const hint = source.type === 'geojson' ? ' describe_sources lists the fields of GeoJSON data.' : '';
        throw new Error(`"${id}" is a ${source.type} source, and inspect_tile reads vector tiles.${hint}`);
    }
    const tiles = source.url ? await openLocation(source.url) : openTiles(source.tiles ?? [], source);
    return {...tiles, name: `source "${id}" (${tiles.name})`, encoding: source.encoding ?? tiles.encoding};
}

async function openLocation(location: string): Promise<TileSource> {
    if (location.startsWith('pmtiles://')) return openPmtiles(location.slice('pmtiles://'.length));
    if (/\.pmtiles(\?|$)/.test(location)) return openPmtiles(location);
    if (location.includes('{z}')) return openTiles([location], {});
    return openTileJson(location);
}

async function openTileJson(url: string): Promise<TileSource> {
    const tileJson = await fetchJson<TileJson>(url);
    const template = tileJson.tiles?.[0];
    if (!template) throw new Error(`The TileJSON at ${url} lists no tiles.`);
    return {
        name: url,
        minzoom: tileJson.minzoom ?? 0,
        maxzoom: tileJson.maxzoom ?? 22,
        center: tileJson.center,
        tms: tileJson.scheme === 'tms',
        getTile: (z, x, y) => fetchTile(template, z, x, y, url),
    };
}

function openTiles(tiles: string[], {minzoom = 0, maxzoom = 22, scheme}: {minzoom?: number; maxzoom?: number; scheme?: string}): TileSource {
    if (tiles.length === 0) throw new Error('The source has neither a url nor tiles.');
    return {name: tiles[0], minzoom, maxzoom, tms: scheme === 'tms', getTile: (z, x, y) => fetchTile(tiles[0], z, x, y)};
}

async function openPmtiles(location: string): Promise<TileSource> {
    const archive = new PMTiles(/^https?:\/\//.test(location) ? location : fileSource(location));
    const header = await archive.getHeader();
    if (RASTER_TILE_TYPES.has(header.tileType)) {
        throw new Error(`${location} holds ${TileType[header.tileType]} images, and inspect_tile reads vector tiles.`);
    }
    return {
        name: location,
        minzoom: header.minZoom,
        maxzoom: header.maxZoom,
        center: [header.centerLon, header.centerLat, header.centerZoom],
        tms: false,
        encoding: header.tileType === TileType.Mlt ? 'mlt' : undefined,
        getTile: async (z, x, y) => {
            const tile = await archive.getZxy(z, x, y);
            return tile && new Uint8Array(tile.data);
        },
    };
}

/** Reads a local PMTiles archive, which the pmtiles package only reads over HTTP. */
function fileSource(path: string): Source {
    const file = checkFileAccess(path);
    return {
        getKey: () => file,
        getBytes: async (offset, length) => {
            const handle = await open(file);
            try {
                const bytes = new Uint8Array(length);
                const {bytesRead} = await handle.read(bytes, 0, length, offset);
                return {data: bytes.buffer.slice(0, bytesRead)};
            } finally {
                await handle.close();
            }
        },
    };
}

/** Fetches a tile, resolving a relative tile URL against the TileJSON it came from. A missing tile is undefined. */
async function fetchTile(template: string, z: number, x: number, y: number, base?: string): Promise<Uint8Array | undefined> {
    const url = new URL(template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), base).href;
    const response = await fetch(url);
    if (response.status === 204 || response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Fetching ${url} failed with HTTP ${response.status}.`);
    return new Uint8Array(await response.arrayBuffer());
}

async function inspect(source: TileSource, style: StyleSpecification | undefined, input: InspectInput): Promise<string> {
    const center = input.center ?? style?.center ?? source.center?.slice(0, 2);
    if (!center) throw new Error('Pass center, since neither the style nor the source has a default place.');
    const zoom = Math.floor(input.zoom ?? style?.zoom ?? source.maxzoom);
    const z = Math.min(Math.max(zoom, source.minzoom), source.maxzoom);
    const [x, y] = tileAt(center, z, source.tms);
    const bytes = await source.getTile(z, x, y);
    const tile = bytes && bytes.length > 0 ? decode(bytes, source.encoding) : undefined;

    const format = tile && bytes ? `, ${tile.encoding.toUpperCase()}, ${(bytes.length / 1024).toFixed(1)} kB` : '';
    const lines = [`Tile ${z}/${x}/${y} of ${source.name}, at [${center.join(', ')}]${format}.`];
    if (zoom > source.maxzoom) lines.push(`The source has no tiles above zoom ${source.maxzoom}, so maps show this tile at zoom ${zoom} too.`);
    if (zoom < source.minzoom) lines.push(`The source has no tiles below zoom ${source.minzoom}, so maps show none of its data at zoom ${zoom}.`);
    if (!tile) return [...lines, 'The tile is empty.'].join('\n');

    const names = input.layer === undefined ? Object.keys(tile.layers) : [input.layer];
    if (input.layer !== undefined && !tile.layers[input.layer]) {
        return [...lines, `The tile has no source layer "${input.layer}". It has: ${Object.keys(tile.layers).join(', ')}.`].join('\n');
    }
    for (const name of names) lines.push('', ...describeLayer(name, tile.layers[name], input.examples ?? DEFAULT_EXAMPLES));
    return lines.join('\n');
}

/** Returns the x and y of the tile at a place, in the scheme the source uses. */
function tileAt([lng, lat]: number[], z: number, tms: boolean): [number, number] {
    const tiles = 2 ** z;
    const wrapped = ((lng + 180) % 360 + 360) % 360 - 180;
    const x = Math.min(Math.max(Math.floor(mercatorX(wrapped) * tiles), 0), tiles - 1);
    const y = Math.min(Math.max(Math.floor(mercatorY(lat) * tiles), 0), tiles - 1);
    return [x, tms ? tiles - 1 - y : y];
}

/** Decodes an MVT or MLT tile, gzipped or not, into the features of each source layer. */
function decode(bytes: Uint8Array, encoding: Encoding | undefined): {encoding: Encoding; layers: Record<string, Feature[]>} {
    const data = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
    const found = encoding ?? (isMlt(data) ? 'mlt' : 'mvt');
    return {encoding: found, layers: found === 'mlt' ? decodeMlt(data) : decodeMvt(data)};
}

/**
 * An MLT tile starts with the length of its first layer and then tag 1. In an MVT tile, the byte after the leading
 * tag is the length of a layer, which is never 1.
 */
function isMlt(data: Uint8Array): boolean {
    let end = 0;
    while (end < data.length && data[end] & 0x80) end++;
    return data[end + 1] === 1;
}

function decodeMvt(data: Uint8Array): Record<string, Feature[]> {
    const tile = new VectorTile(new PbfReader(data));
    return Object.fromEntries(Object.values(tile.layers).map(layer => [layer.name, Array.from({length: layer.length}, (_, index) => {
        const feature = layer.feature(index);
        return {geometryType: VectorTileFeature.types[feature.type], properties: feature.properties};
    })]));
}

function decodeMlt(data: Uint8Array): Record<string, Feature[]> {
    return Object.fromEntries(decodeTile(data).map(table => [table.name, table.getFeatures().map(feature => ({
        geometryType: MLT_GEOMETRY_TYPES[feature.geometry.type],
        properties: feature.properties,
    }))]));
}

function describeLayer(name: string, features: Feature[], examples: number): string[] {
    const fields = fieldValues(features);
    const folded = new Set<string>();
    const lines = [`${name}: ${plural(features.length, 'feature')} (${geometryTypes(features)})`];
    for (const [family, members] of fieldFamilies([...fields.keys()])) {
        if (isFolded(family, members)) {
            lines.push(`  ${family}: ${members.length} fields`);
            for (const member of members) folded.add(member);
        } else {
            for (const field of members) {
                const values = fields.get(field);
                if (values) lines.push(`  ${describeField(field, values, features.length)}`);
            }
        }
    }
    const shown = distinctExamples(features, examples, folded);
    if (shown.length > 0) lines.push('  Examples:', ...shown.map(example => `    ${example}`));
    return lines;
}

/** Returns up to `count` features whose shown properties differ, since tiles often repeat the same ones. */
function distinctExamples(features: Feature[], count: number, folded: Set<string>): string[] {
    const examples = new Set<string>();
    for (const feature of features) {
        if (examples.size >= count) break;
        examples.add(formatProperties(feature.properties, folded));
    }
    return [...examples];
}

/** Counts the values of every field, in the order fields first appear. MLT marks a missing value with null. */
function fieldValues(features: Feature[]): Map<string, FieldValues> {
    const fields = new Map<string, FieldValues>();
    for (const {properties} of features) {
        for (const [field, value] of Object.entries(properties)) {
            if (value === null || value === undefined) continue;
            const entry = fields.get(field) ?? {features: 0, values: new Map()};
            const key = formatValue(value);
            entry.features++;
            entry.values.set(key, (entry.values.get(key) ?? 0) + 1);
            fields.set(field, entry);
        }
    }
    return fields;
}

function describeField(field: string, {features, values}: FieldValues, total: number): string {
    const presence = features < total ? ` (in ${features} of ${total})` : '';
    const byCount = [...values].sort((a, b) => b[1] - a[1]);
    const listed = byCount.length > MAX_LISTED_VALUES ?
        `${byCount.length} different values, like ${byCount.slice(0, 3).map(([value]) => value).join(', ')}` :
        byCount.map(([value, count]) => `${value} (${count})`).join(', ');
    return `${field}${presence}: ${listed}`;
}

function geometryTypes(features: Feature[]): string {
    const counts = new Map<string, number>();
    for (const {geometryType} of features) counts.set(geometryType, (counts.get(geometryType) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${count} ${type}`).join(', ');
}

/** Writes a value the way a style would compare against it, with strings in quotes. */
function formatValue(value: unknown): string {
    return typeof value === 'bigint' ? value.toString() : JSON.stringify(value, bigintAsString);
}

function formatProperties(properties: Record<string, unknown>, folded: Set<string>): string {
    const shown = Object.entries(properties).filter(([field, value]) => !folded.has(field) && value !== null && value !== undefined);
    return JSON.stringify(Object.fromEntries(shown), bigintAsString);
}

function bigintAsString(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

import {VectorTile} from '@mapbox/vector-tile';
import type {VectorSourceSpecification} from '@maplibre/maplibre-gl-style-spec';
import {decodeTile, GEOMETRY_TYPE} from '@maplibre/mlt';
import {open} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {PbfReader} from 'pbf';
import {PMTiles, type Source, TileType} from 'pmtiles';
import {mercatorX, mercatorY} from './render-style.js';
import {checkFileAccess, fetchJson} from './style-input.js';
import type {TileJson} from './toolsets/style/describe-sources.js';

export type Encoding = 'mvt' | 'mlt';

/** A source of vector tiles, whether a style names it or it is given by its URL. */
export type TileSource = {
    /** How reports name the source, like its TileJSON URL. */
    name: string;
    minzoom: number;
    maxzoom: number;
    /** `[longitude, latitude, zoom]` to read when the caller gives no place. */
    center?: number[];
    tms: boolean;
    encoding?: Encoding;
    getTile: (z: number, x: number, y: number) => Promise<Uint8Array | undefined>;
};

/** The simple geometry types, which MapLibre's `geometry-type` also reports for multi-geometries. */
export type GeometryType = 'Point' | 'LineString' | 'Polygon' | 'Unknown';

/** A feature as filters and expressions see it, without its geometry. */
export type Feature = {geometryType: GeometryType; properties: Record<string, unknown>; id?: unknown};

/** The tile of a source at a place, and the zoom it was asked for, which can lie outside the source's zoom range. */
export type TileRead = {
    zoom: number;
    z: number;
    x: number;
    y: number;
    bytes?: Uint8Array;
    encoding?: Encoding;
    layers?: Record<string, Feature[]>;
};

const RASTER_TILE_TYPES = new Set([TileType.Png, TileType.Jpeg, TileType.Webp, TileType.Avif]);

const MVT_GEOMETRY_TYPES: GeometryType[] = ['Unknown', 'Point', 'LineString', 'Polygon'];

const MLT_GEOMETRY_TYPES: Record<GEOMETRY_TYPE, GeometryType> = {
    [GEOMETRY_TYPE.POINT]: 'Point',
    [GEOMETRY_TYPE.MULTIPOINT]: 'Point',
    [GEOMETRY_TYPE.LINESTRING]: 'LineString',
    [GEOMETRY_TYPE.MULTILINESTRING]: 'LineString',
    [GEOMETRY_TYPE.POLYGON]: 'Polygon',
    [GEOMETRY_TYPE.MULTIPOLYGON]: 'Polygon',
};

/** Opens a vector source of a style, named in reports by its id. */
export async function openVectorSource(id: string, source: VectorSourceSpecification): Promise<TileSource> {
    const tiles = source.url ? await openLocation(source.url) : openTiles(source.tiles ?? [], source);
    return {...tiles, name: `source "${id}" (${tiles.name})`, encoding: source.encoding ?? tiles.encoding};
}

/** Opens a source given by a TileJSON URL, a PMTiles archive, or a tile URL with `{z}`, `{x}` and `{y}`. */
export async function openLocation(location: string): Promise<TileSource> {
    if (location.startsWith('pmtiles://')) return openPmtiles(location.slice('pmtiles://'.length));
    if (/\.pmtiles(\?|$)/.test(location)) return openPmtiles(location);
    if (location.includes('{z}')) return openTiles([location], {});
    return openTileJson(location);
}

/** Reads and decodes the tile of a source at a place, at the zoom closest to `zoom` that the source has. */
export async function readTile(source: TileSource, center: number[], zoom: number): Promise<TileRead> {
    const wanted = Math.floor(zoom);
    const z = Math.min(Math.max(wanted, source.minzoom), source.maxzoom);
    const [x, y] = tileAt(center, z, source.tms);
    const bytes = await source.getTile(z, x, y);
    if (!bytes || bytes.length === 0) return {zoom: wanted, z, x, y};
    return {zoom: wanted, z, x, y, bytes, ...decode(bytes, source.encoding)};
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
    if (RASTER_TILE_TYPES.has(header.tileType)) throw new Error(`${location} holds ${TileType[header.tileType]} images, not vector tiles.`);
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
        return {geometryType: MVT_GEOMETRY_TYPES[feature.type], properties: feature.properties, id: feature.id};
    })]));
}

function decodeMlt(data: Uint8Array): Record<string, Feature[]> {
    return Object.fromEntries(decodeTile(data).map(table => [table.name, table.getFeatures().map(feature => ({
        geometryType: MLT_GEOMETRY_TYPES[feature.geometry.type],
        properties: feature.properties,
        id: feature.id,
    }))]));
}

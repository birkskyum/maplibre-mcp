import type {LayerSpecification, SourceSpecification, StyleSpecification} from '@maplibre/maplibre-gl-style-spec';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {registerAppResource, registerAppTool, RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';
import type {McpServer} from '@modelcontextprotocol/server';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {MAPLIBRE_VERSION} from './renderer.js';

type Bounds = [number, number, number, number];

type Marker = {
    position: [number, number];
    label?: string;
    color?: string;
};

/** What the map view draws. It reaches the view as the structured content of the tool result. */
export type MapPayload = {
    style: string;
    sources: Record<string, SourceSpecification>;
    layers: LayerSpecification[];
    markers: Marker[];
    camera: {center: [number, number]; zoom: number; bearing: number; pitch: number} | {bounds: Bounds};
};

type GeoJson = {
    type?: string;
    features?: GeoJson[];
    geometry?: GeoJson | null;
    geometries?: GeoJson[];
    coordinates?: unknown;
};

const RESOURCE_URI = 'ui://maplibre/show-map.html';
const TILES = 'https://tiles.openfreemap.org';
const CDN = 'https://cdn.jsdelivr.net';
const BASEMAPS = ['liberty', 'bright', 'positron', 'dark', 'fiord'] as const;
const LAYER_TYPES = ['fill', 'line', 'circle', 'symbol', 'fill-extrusion', 'heatmap'] as const;
const GEOJSON_TYPES = new Set([
    'FeatureCollection', 'Feature', 'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection',
]);
const VIEW_SCRIPT = new URL(import.meta.url.endsWith('.ts') ? '../../../dist/show-map-view.js' : './show-map-view.js', import.meta.url);

/**
 * Origins the view loads from. MapLibre starts its worker from a blob, which hosts only allow with
 * `workerDomains`, a field proposed in modelcontextprotocol/ext-apps#566.
 */
const CSP = {
    connectDomains: [TILES],
    resourceDomains: [CDN, TILES],
    workerDomains: ['blob:'],
};

export function registerShowMap(server: McpServer): void {
    registerAppTool(server, 'show_map', {
        title: 'Show map',
        description: [
            'Shows the user an interactive MapLibre map in the chat, with GeoJSON layers and markers on an OpenFreeMap basemap.',
            'The user sees the map and you do not; to look at a map yourself, use render_style.',
            'Without center and zoom, the map fits the layers and markers. Needs a client that supports MCP Apps.',
        ].join(' '),
        inputSchema: z.object({
            layers: z.array(z.object({
                type: z.enum(LAYER_TYPES),
                data: z.record(z.string(), z.unknown()).describe('A GeoJSON FeatureCollection, Feature or geometry.'),
                paint: z.record(z.string(), z.unknown()).optional().describe('Paint properties for the layer type, like {"fill-color": "#d33"}.'),
                layout: z.record(z.string(), z.unknown()).optional().describe('Layout properties for the layer type.'),
            })).default([]),
            markers: z.array(z.object({
                position: z.array(z.number()).length(2).describe('[longitude, latitude]'),
                label: z.string().optional().describe('Shown in a popup when the user clicks the marker.'),
                color: z.string().optional(),
            })).default([]),
            basemap: z.enum(BASEMAPS).default('liberty').describe('The OpenFreeMap style to draw on.'),
            center: z.array(z.number()).length(2).optional().describe('[longitude, latitude] of the map center.'),
            zoom: z.number().min(0).max(22).optional(),
            bearing: z.number().optional(),
            pitch: z.number().min(0).max(85).optional(),
        }),
        annotations: {readOnlyHint: true},
        _meta: {ui: {resourceUri: RESOURCE_URI}},
    }, async input => {
        const invalidData = input.layers.findIndex(layer => !GEOJSON_TYPES.has(String(layer.data.type)));
        if (invalidData !== -1) return errorResult(`The data of layer ${invalidData} is not GeoJSON: its type is ${String(input.layers[invalidData].data.type)}.`);

        const sources = Object.fromEntries(input.layers.map((layer, index) => [`data-${index}`, {type: 'geojson', data: layer.data}]));
        const layers = input.layers.map((layer, index) => ({
            id: `data-${index}`,
            type: layer.type,
            source: `data-${index}`,
            paint: layer.paint ?? {},
            layout: layer.layout ?? {},
        }));
        const overlay = {version: 8, sources, layers} as StyleSpecification;
        const problems = validateStyleMin(overlay);
        if (problems.length > 0) return errorResult(problems.map(problem => problem.message).join('\n'));

        const markers = input.markers.map(toMarker);
        const payload: MapPayload = {
            style: `${TILES}/styles/${input.basemap}`,
            sources: overlay.sources,
            layers: overlay.layers,
            markers,
            camera: resolveCamera(input, input.layers.map(layer => layer.data), markers),
        };
        return {
            content: [{type: 'text', text: `Showing the user a map with ${layers.length} layers and ${markers.length} markers.`}],
            structuredContent: payload,
        };
    });

    registerAppResource(server, 'MapLibre map', RESOURCE_URI, {mimeType: RESOURCE_MIME_TYPE}, async () => ({
        contents: [{uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(), _meta: {ui: {csp: CSP}}}],
    }));
}

function errorResult(text: string): {isError: true; content: {type: 'text'; text: string}[]} {
    return {isError: true, content: [{type: 'text', text}]};
}

function toMarker({position: [lng, lat], label, color}: {position: number[]; label?: string; color?: string}): Marker {
    return {position: [lng, lat], label, color};
}

type CameraInput = {center?: number[]; zoom?: number; bearing?: number; pitch?: number};

function resolveCamera(input: CameraInput, data: GeoJson[], markers: Marker[]): MapPayload['camera'] {
    const bounds = boundsOf(data, markers);
    if (input.center === undefined && input.zoom === undefined && bounds) return {bounds};
    const [lng, lat] = input.center ?? [0, 20];
    return {center: [lng, lat], zoom: input.zoom ?? (input.center ? 12 : 1), bearing: input.bearing ?? 0, pitch: input.pitch ?? 0};
}

/** Returns [west, south, east, north] around every position in the data and markers. */
function boundsOf(data: GeoJson[], markers: Marker[]): Bounds | undefined {
    const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const geojson of data) extendByGeoJson(bounds, geojson);
    for (const marker of markers) extendByPositions(bounds, marker.position);
    return bounds[0] <= bounds[2] ? bounds : undefined;
}

function extendByGeoJson(bounds: Bounds, geojson: GeoJson | null | undefined): void {
    if (!geojson) return;
    for (const feature of geojson.features ?? []) extendByGeoJson(bounds, feature);
    for (const geometry of geojson.geometries ?? []) extendByGeoJson(bounds, geometry);
    extendByGeoJson(bounds, geojson.geometry);
    extendByPositions(bounds, geojson.coordinates);
}

function extendByPositions(bounds: Bounds, coordinates: unknown): void {
    if (!Array.isArray(coordinates)) return;
    const [lng, lat] = coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number') {
        for (const item of coordinates) extendByPositions(bounds, item);
        return;
    }
    bounds[0] = Math.min(bounds[0], lng);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lng);
    bounds[3] = Math.max(bounds[3], lat);
}

async function viewHtml(): Promise<string> {
    const script = (await readFile(VIEW_SCRIPT, 'utf8')).replaceAll('</script', '<\\/script');
    const dist = `${CDN}/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist`;
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${dist}/maplibre-gl.css">
<link rel="modulepreload" href="${dist}/maplibre-gl.mjs">
<style>html, body { margin: 0; } #map { width: 100%; height: 480px; }</style>
</head>
<body>
<div id="map"></div>
<script type="module">${script}</script>
</body>
</html>`;
}

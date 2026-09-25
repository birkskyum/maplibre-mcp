import {
    type FeatureFilter,
    featureFilter,
    type LayerSpecification,
    latest,
    normalizePropertyExpression,
    type PropertyValueSpecification,
    type SourceSpecification,
    type StylePropertySpecification,
    type StyleSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {fetchJson, loadStyle, STYLE_INPUT, type StyleInput} from '../../style-input.js';
import {type Feature, type GeometryType, openVectorSource, readTile} from '../../tiles.js';
import {collectFeatures, filterFields, type GeoJson} from './describe-sources.js';
import {describeField, fieldValues} from './inspect-tile.js';

type DebugInput = StyleInput & {center?: number[]; zoom?: number; layers?: string[]};

/** The features a source has at the place, keyed by source layer, or why there are none. */
type SourceData = {features?: Record<string, Feature[]>; problem?: string; read?: string};

type Status = 'draws' | 'nothing' | 'hidden' | 'zoom';

/** What a layer draws, and for a filter that matches nothing, the data it was matched against. */
type Verdict = {status: Status; text: string; values?: FilterValues};

/** The fields a filter reads that the data has, to list with their values. */
type FilterValues = {label: string; features: Feature[]; fields: string[]};

/** What the checks of a layer evaluate against. */
type Context = {style: StyleSpecification; zoom: number; globalState: Record<string, unknown>; images?: Set<string>; spriteProblem?: string};

/** Whether a symbol layer's text or icons are set up, and if so, what keeps them from showing. */
type SymbolPart = {configured: boolean; problem?: string};

type Property = readonly ['paint' | 'layout', string];

/** The style spec's definitions of paint and layout properties, keyed like `paint_line`. */
const PROPERTY_SPECIFICATIONS = latest as unknown as Record<string, Record<string, StylePropertySpecification> | undefined>;

/** Properties that hide a layer when they come out as 0. */
const ZERO_HIDES: Property[] = [
    ['paint', 'fill-opacity'], ['paint', 'line-opacity'], ['paint', 'line-width'], ['paint', 'circle-opacity'],
    ['paint', 'circle-radius'], ['paint', 'fill-extrusion-opacity'], ['paint', 'heatmap-opacity'], ['paint', 'raster-opacity'],
    ['paint', 'background-opacity'], ['paint', 'color-relief-opacity'],
];
const COLOR_HIDES = ['fill-color', 'line-color', 'circle-color', 'fill-extrusion-color', 'background-color'];
const TEXT_HIDES: Property[] = [['paint', 'text-opacity'], ['layout', 'text-size']];
const ICON_HIDES: Property[] = [['paint', 'icon-opacity'], ['layout', 'icon-size']];
const POLYGON_LAYERS = new Set(['fill', 'fill-extrusion']);
/** Data-driven properties are evaluated for at most this many features of a layer. */
const MAX_EVALUATED = 1000;

export function registerDebugLayers(server: McpServer): void {
    server.registerTool('debug_layers', {
        title: 'Debug layers',
        description: [
            'Says for each layer of a style whether it draws anything at a place and zoom, and when it draws nothing, why:',
            'it is hidden or outside its zoom range, the tile lacks its source layer, its filter matches no feature (listed with',
            'the values the tile has), a fill layer gets no polygons, its opacity, width or size is 0 or its color transparent,',
            'text lacks a glyphs URL, or icons are missing from the sprite. It reads the vector tiles and GeoJSON data at the place.',
            'Use it when a layer draws nothing. Pass the style as an object, a URL or a file path.',
        ].join(' '),
        inputSchema: z.object({
            ...STYLE_INPUT,
            center: z.array(z.number()).length(2).optional().describe('[longitude, latitude] of the place. Defaults to the center of the style.'),
            zoom: z.number().min(0).max(24).optional().describe('Zoom level. Defaults to the zoom of the style.'),
            layers: z.array(z.string()).optional().describe('Only check these layers, by id. Defaults to every layer.'),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async input => ({content: [{type: 'text', text: await debugLayers(input)}]}));
}

async function debugLayers(input: DebugInput): Promise<string> {
    const style = await loadStyle(input);
    const center = input.center ?? style.center;
    const zoom = input.zoom ?? style.zoom;
    if (!center || zoom === undefined) throw new Error('Pass center and zoom, since the style has no default view.');
    const layers = selectLayers(style, input.layers);
    const sources = await readSources(style, layers.map(([layer]) => layer), center, zoom);
    const context: Context = {style, zoom, globalState: globalState(style), ...await readSprite(style)};
    const verdicts = layers.map(([layer, index]) => ({layer, verdict: judge(layer, index, sources, context)}));

    const lines = [`At [${center.join(', ')}], zoom ${zoom}: ${summary(verdicts.map(({verdict}) => verdict.status))}.`];
    for (const [id, data] of sources) if (data.read) lines.push(`Read source "${id}": ${data.read}.`);
    lines.push('', ...verdicts.map(({layer, verdict}) => `${layer.id} (${layer.type}): ${verdict.text}`));
    const values = valueLines(verdicts.flatMap(({verdict}) => verdict.values ? [verdict.values] : []));
    if (values.length > 0) lines.push('', 'The values here of the fields read by filters that match nothing:', ...values);
    return lines.join('\n');
}

/** Returns the layers to check with their index in the style, which expression errors refer to. */
function selectLayers(style: StyleSpecification, ids: string[] | undefined): [LayerSpecification, number][] {
    const indexed = style.layers.map((layer, index): [LayerSpecification, number] => [layer, index]);
    if (!ids) return indexed;
    const missing = ids.filter(id => !style.layers.some(layer => layer.id === id));
    if (missing.length > 0) throw new Error(`The style has no layer ${missing.map(id => `"${id}"`).join(', ')}.`);
    return indexed.filter(([layer]) => ids.includes(layer.id));
}

/** Reads the data of the vector and GeoJSON sources the layers use, at the place. */
async function readSources(style: StyleSpecification, layers: LayerSpecification[], center: number[], zoom: number): Promise<Map<string, SourceData>> {
    const ids = [...new Set(layers.flatMap(layer => 'source' in layer && style.sources[layer.source] ? [layer.source] : []))];
    return new Map(await Promise.all(ids.map(async (id): Promise<[string, SourceData]> => {
        const data = await readSource(id, style.sources[id], center, zoom)
            .catch(error => ({problem: `its source "${id}" could not be read: ${error.message}`}));
        return [id, data];
    })));
}

async function readSource(id: string, source: SourceSpecification, center: number[], zoom: number): Promise<SourceData> {
    if (source.type === 'geojson') {
        const features = collectFeatures(typeof source.data === 'string' ? await fetchJson<GeoJson>(source.data) : source.data);
        return {features: {'': features.map(geoJsonFeature)}, read: `all ${features.length} features of its GeoJSON data`};
    }
    if (source.type !== 'vector') return {};
    const tiles = await openVectorSource(id, source);
    if (Math.floor(zoom) < tiles.minzoom) return {problem: `source "${id}" has no tiles below zoom ${tiles.minzoom}`};
    const tile = await readTile(tiles, center, zoom);
    const at = `tile ${tile.z}/${tile.x}/${tile.y}${tile.z < tile.zoom ? ', its highest zoom' : ''}`;
    if (!tile.layers) return {problem: `the tile of source "${id}" is empty here`, read: `${at}, empty`};
    return {features: tile.layers, read: `${at}, ${tile.encoding?.toUpperCase()}`};
}

function geoJsonFeature(feature: GeoJson): Feature {
    return {geometryType: simpleGeometryType(feature.geometry?.type), properties: feature.properties ?? {}};
}

function simpleGeometryType(type: string | undefined): GeometryType {
    const simple = type?.replace(/^Multi/, '');
    return simple === 'Point' || simple === 'LineString' || simple === 'Polygon' ? simple : 'Unknown';
}

/** The default values of the style's global state, which filters and expressions can read. */
function globalState(style: StyleSpecification): Record<string, unknown> {
    return Object.fromEntries(Object.entries(style.state ?? {}).map(([name, schema]) => [name, schema.default]));
}

/** Collects the names of the images in the style's sprites, or why they could not be read. */
async function readSprite(style: StyleSpecification): Promise<{images?: Set<string>; spriteProblem?: string}> {
    if (!style.sprite) return {};
    const sprites = typeof style.sprite === 'string' ? [{id: 'default', url: style.sprite}] : style.sprite;
    try {
        const indexes = await Promise.all(sprites.map(async ({id, url}) => {
            const names = Object.keys(await fetchJson<Record<string, unknown>>(`${url}.json`));
            return names.map(name => id === 'default' ? name : `${id}:${name}`);
        }));
        return {images: new Set(indexes.flat())};
    } catch (error) {
        return {spriteProblem: `the sprite could not be read: ${error instanceof Error ? error.message : error}`};
    }
}

function judge(layer: LayerSpecification, index: number, sources: Map<string, SourceData>, context: Context): Verdict {
    const {zoom} = context;
    if (layer.layout?.visibility === 'none') return {status: 'hidden', text: 'hidden, its visibility is none.'};
    if (layer.minzoom !== undefined && zoom < layer.minzoom) return {status: 'zoom', text: `outside its zoom range, it starts at zoom ${layer.minzoom}.`};
    if (layer.maxzoom !== undefined && zoom >= layer.maxzoom) return {status: 'zoom', text: `outside its zoom range, it ends at zoom ${layer.maxzoom}.`};
    if (!('source' in layer)) return checkDrawing(layer, index, [], context, '');
    if (!context.style.sources[layer.source]) return nothing(`the style has no source "${layer.source}".`);

    const data = sources.get(layer.source) ?? {};
    if (data.problem) return nothing(`${data.problem}.`);
    if (!data.features) return checkDrawing(layer, index, [], context, '');

    const sourceLayer = 'source-layer' in layer && layer['source-layer'] ? layer['source-layer'] : '';
    const features = data.features[sourceLayer];
    if (!features) return nothing(`the tile has no source layer "${sourceLayer}". It has: ${Object.keys(data.features).join(', ')}.`);
    const of = `${plural(features.length, 'feature')}${sourceLayer ? ` in source layer "${sourceLayer}"` : ''}`;

    let filter: FeatureFilter;
    try {
        filter = featureFilter(layer.filter, `layers[${index}].filter`, context.globalState);
    } catch (error) {
        return nothing(`its filter is not valid (${error instanceof Error ? error.message : error}). validate_style shows the details.`);
    }
    if (filter.needGeometry) return checkDrawing(layer, index, features, context, ` of the ${of}, as its filter needs geometry, which is not checked`);
    const matched = quietly(() => features.filter(feature => filter.filter({zoom}, specFeature(feature))));
    if (matched.length === 0) return filterMatchesNothing(layer.filter, features, sourceLayer || layer.source, of);
    if (POLYGON_LAYERS.has(layer.type) && !matched.some(feature => feature.geometryType === 'Polygon')) {
        return nothing(`it matches ${matched.length} of the ${of}, but none are polygons, which a ${layer.type} layer needs.`);
    }
    if (layer.type === 'line' && matched.every(feature => feature.geometryType === 'Point')) {
        return nothing(`it matches ${matched.length} of the ${of}, but they are all points, which a line layer cannot draw.`);
    }
    return checkDrawing(layer, index, matched, context, ` of the ${of}`);
}

/** Checks the paint and layout of a layer that has data to draw, and says what it draws. */
function checkDrawing(layer: LayerSpecification, index: number, features: Feature[], context: Context, of: string): Verdict {
    const zero = zeroProperties(layer, index, features, context, ZERO_HIDES).map(property => `${property} is 0`);
    const transparent = COLOR_HIDES.filter(property => evaluate(layer, index, 'paint', property, features, context).some(isTransparent));
    const reasons = [...zero, ...transparent.map(property => `${property} is transparent`)];
    if (reasons.length > 0) return nothing(`${listOf(reasons)} at zoom ${context.zoom}.`);
    const drawn = features.length > 0 ? `draws ${features.length}${of}` : 'draws';
    if (layer.type !== 'symbol') return {status: 'draws', text: `${drawn}.`};

    const text = checkText(layer, index, features, context);
    const icon = checkIcon(layer, index, features, context);
    if (!text.configured && !icon.configured) return nothing('it has neither a text-field nor an icon-image.');
    if (!shows(text) && !shows(icon)) return nothing(`${[text.problem, icon.problem].filter(isString).join(', and ')}.`);
    const notes = [
        text.problem ? ` Its text doesn't show, since ${text.problem}.` : '',
        icon.problem ? ` Its icons don't show, since ${icon.problem}.` : '',
    ];
    return {status: 'draws', text: `${drawn}.${notes.join('')}`};
}

function shows(part: SymbolPart): boolean {
    return part.configured && !part.problem;
}

function checkText(layer: LayerSpecification, index: number, features: Feature[], context: Context): SymbolPart {
    if (!layer.layout || !('text-field' in layer.layout)) return {configured: false};
    if (!context.style.glyphs) return {configured: true, problem: 'the style has no glyphs URL'};
    const zero = zeroProperties(layer, index, features, context, TEXT_HIDES);
    if (zero.length > 0) return {configured: true, problem: `${listOf(zero)} is 0 at zoom ${context.zoom}`};
    const texts = evaluatedStrings(layer, index, 'text-field', features, context);
    if (texts.length > 0 && texts.every(text => text === '')) return {configured: true, problem: 'text-field is empty for every feature'};
    return {configured: true};
}

function checkIcon(layer: LayerSpecification, index: number, features: Feature[], context: Context): SymbolPart {
    if (!layer.layout || !('icon-image' in layer.layout)) return {configured: false};
    const zero = zeroProperties(layer, index, features, context, ICON_HIDES);
    if (zero.length > 0) return {configured: true, problem: `${listOf(zero)} is 0 at zoom ${context.zoom}`};
    const names = [...new Set(evaluatedStrings(layer, index, 'icon-image', features, context))].filter(Boolean);
    if (names.length === 0) return {configured: true, problem: 'icon-image is empty for every feature'};
    if (!context.style.sprite) return {configured: true, problem: 'the style has no sprite'};
    if (context.spriteProblem) return {configured: true, problem: context.spriteProblem};
    const missing = names.filter(name => !context.images?.has(name));
    if (missing.length === 0) return {configured: true};
    const listed = `${missing.slice(0, 5).map(name => `"${name}"`).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`;
    return {configured: true, problem: missing.length === names.length ? `the sprite has none of the icons it uses, like ${listed}` : `the sprite lacks the icons ${listed}`};
}

/**
 * Evaluates a text-field or icon-image as strings, one per feature, filling in legacy `{field}` tokens the way GL JS
 * does when the style gives a plain string.
 */
function evaluatedStrings(layer: LayerSpecification, index: number, property: string, features: Feature[], context: Context): string[] {
    const tokens = typeof (layer.layout as Record<string, unknown> | undefined)?.[property] === 'string';
    return evaluate(layer, index, 'layout', property, features, context).map((value, position) => {
        const text = String(value ?? '');
        return tokens ? text.replace(/{([^{}]+)}/g, (_, field: string) => String(features[position]?.properties[field] ?? '')) : text;
    });
}

/** Returns the properties that come out as 0 for every feature, or when evaluated once without a feature. */
function zeroProperties(layer: LayerSpecification, index: number, features: Feature[], context: Context, properties: Property[]): string[] {
    return properties
        .filter(([group, property]) => {
            const values = evaluate(layer, index, group, property, features, context);
            return values.length > 0 && values.every(value => value === 0);
        })
        .map(([, property]) => property);
}

/** Evaluates a property the layer sets, for each feature or once without one. Unset properties give nothing. */
function evaluate(layer: LayerSpecification, index: number, group: 'paint' | 'layout', property: string, features: Feature[], context: Context): unknown[] {
    const value = (layer[group] as Record<string, PropertyValueSpecification<unknown>> | undefined)?.[property];
    const specification = PROPERTY_SPECIFICATIONS[`${group}_${layer.type}`]?.[property];
    if (value === undefined || !specification) return [];
    try {
        const expression = normalizePropertyExpression(value, `layers[${index}].${group}.${property}`, specification, context.globalState);
        const targets = features.length > 0 ? features.slice(0, MAX_EVALUATED) : [undefined];
        return quietly(() => targets.map(feature => expression.evaluate({zoom: context.zoom}, feature && specFeature(feature))));
    } catch {
        return [];
    }
}

/** A feature in the shape the style spec's filters and expressions read. */
function specFeature(feature: Feature): {type: GeometryType; properties: Record<string, unknown>; id?: unknown} {
    return {type: feature.geometryType, properties: feature.properties, id: feature.id};
}

function isTransparent(value: unknown): boolean {
    return typeof value === 'object' && value !== null && 'a' in value && value.a === 0;
}

function isString(value: string | undefined): value is string {
    return value !== undefined;
}

/** Says that a filter matches nothing, names the fields it reads that no feature has, and keeps the others to list. */
function filterMatchesNothing(filter: unknown, features: Feature[], label: string, of: string): Verdict {
    const fields = [...filterFields(filter)];
    const missing = fields.filter(field => !features.some(feature => feature.properties[field] !== undefined && feature.properties[field] !== null));
    const notes = missing.map(field => ` No feature has the field "${field}".`).join('');
    return {...nothing(`its filter matches none of the ${of}.${notes}`), values: {label, features, fields: fields.filter(field => !missing.includes(field))}};
}

/** Lists the values of each field that filters read once, per source layer, since many layers read the same ones. */
function valueLines(filters: FilterValues[]): string[] {
    const listed = new Set<string>();
    const lines: string[] = [];
    for (const {label, features, fields} of filters) {
        const values = fieldValues(features);
        for (const field of fields) {
            const found = values.get(field);
            if (!found || listed.has(`${label}.${field}`)) continue;
            listed.add(`${label}.${field}`);
            lines.push(`  ${label}.${describeField(field, found, features.length)}`);
        }
    }
    return lines;
}

/** Runs `run` without the warnings the style spec logs when an expression meets a missing value, which the checks expect. */
function quietly<T>(run: () => T): T {
    const warn = console.warn;
    console.warn = () => {};
    try {
        return run();
    } finally {
        console.warn = warn;
    }
}

function nothing(reason: string): Verdict {
    return {status: 'nothing', text: `draws nothing, since ${reason}`};
}

function summary(statuses: Status[]): string {
    const parts = [
        [countOf(statuses, 'draws'), 'layer draws', 'layers draw'],
        [countOf(statuses, 'nothing'), 'draws nothing', 'draw nothing'],
        [countOf(statuses, 'hidden'), 'is hidden', 'are hidden'],
        [countOf(statuses, 'zoom'), 'is outside its zoom range', 'are outside their zoom range'],
    ] as const;
    return listOf(parts.filter(([total]) => total > 0).map(([total, one, many]) => `${total} ${total === 1 ? one : many}`));
}

function countOf(statuses: Status[], status: Status): number {
    return statuses.filter(value => value === status).length;
}

function listOf(items: string[]): string {
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join('');
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

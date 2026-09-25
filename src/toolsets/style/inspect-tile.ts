import type {SourceSpecification, StyleSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {loadStyle, STYLE_INPUT, type StyleInput} from '../../style-input.js';
import {type Feature, openLocation, openVectorSource, readTile, type TileSource} from '../../tiles.js';
import {fieldFamilies, isFolded} from './describe-sources.js';

type InspectInput = StyleInput & {source?: string; center?: number[]; zoom?: number; layer?: string; examples?: number};

/** How often each value of a field occurs, keyed by the value as the report writes it. */
export type FieldValues = {features: number; values: Map<string, number>};

const DEFAULT_EXAMPLES = 3;
/** Beyond this many different values, a field shows a few of them rather than all. */
const MAX_LISTED_VALUES = 12;
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

function openStyleSource(id: string, source: SourceSpecification): Promise<TileSource> {
    if (source.type !== 'vector') {
        const hint = source.type === 'geojson' ? ' describe_sources lists the fields of GeoJSON data.' : '';
        throw new Error(`"${id}" is a ${source.type} source, and inspect_tile reads vector tiles.${hint}`);
    }
    return openVectorSource(id, source);
}

async function inspect(source: TileSource, style: StyleSpecification | undefined, input: InspectInput): Promise<string> {
    const center = input.center ?? style?.center ?? source.center?.slice(0, 2);
    if (!center) throw new Error('Pass center, since neither the style nor the source has a default place.');
    const {zoom, z, x, y, bytes, encoding, layers} = await readTile(source, center, input.zoom ?? style?.zoom ?? source.maxzoom);

    const format = encoding && bytes ? `, ${encoding.toUpperCase()}, ${(bytes.length / 1024).toFixed(1)} kB` : '';
    const lines = [`Tile ${z}/${x}/${y} of ${source.name}, at [${center.join(', ')}]${format}.`];
    if (zoom > source.maxzoom) lines.push(`The source has no tiles above zoom ${source.maxzoom}, so maps show this tile at zoom ${zoom} too.`);
    if (zoom < source.minzoom) lines.push(`The source has no tiles below zoom ${source.minzoom}, so maps show none of its data at zoom ${zoom}.`);
    if (!layers) return [...lines, 'The tile is empty.'].join('\n');

    const names = input.layer === undefined ? Object.keys(layers) : [input.layer];
    if (input.layer !== undefined && !layers[input.layer]) {
        return [...lines, `The tile has no source layer "${input.layer}". It has: ${Object.keys(layers).join(', ')}.`].join('\n');
    }
    for (const name of names) lines.push('', ...describeLayer(name, layers[name], input.examples ?? DEFAULT_EXAMPLES));
    return lines.join('\n');
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
export function fieldValues(features: Feature[]): Map<string, FieldValues> {
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

export function describeField(field: string, {features, values}: FieldValues, total: number): string {
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

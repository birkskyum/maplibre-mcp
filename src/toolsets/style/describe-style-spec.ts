import type {McpServer} from '@modelcontextprotocol/server';
import {createRequire} from 'node:module';
import {z} from 'zod';

type SpecEntry = {
    type?: string;
    doc?: string;
    default?: unknown;
    values?: Record<string, {doc?: string}> | unknown[];
    minimum?: number;
    maximum?: number;
    units?: string;
    length?: number;
    value?: string;
    required?: boolean;
    requires?: unknown[];
    transition?: boolean;
    expression?: {interpolated?: boolean; parameters?: string[]};
    'sdk-support'?: Record<string, Record<string, string>>;
    example?: unknown;
    syntax?: {
        overloads: {parameters: string[]; 'output-type': string | string[]}[];
        parameters?: {name: string; type?: string | string[]; doc?: string}[];
    };
};

type SpecGroup = Record<string, SpecEntry>;

const REFERENCE = createRequire(import.meta.url)('@maplibre/maplibre-gl-style-spec/src/reference/v8.json');
const SPEC: Record<string, SpecGroup> = REFERENCE;
const EXPRESSIONS: Record<string, SpecEntry> = REFERENCE.expression_name.values;

const PLATFORMS: Record<string, string> = {js: 'GL JS', android: 'Android', ios: 'iOS', macos: 'macOS'};

const SOURCE_TYPES = ['vector', 'raster', 'raster-dem', 'geojson', 'image', 'video'];

/** Groups of properties that are not layer properties, with the phrase that places them. */
const OTHER_PROPERTY_GROUPS: Record<string, string> = {
    sky: 'property of the sky',
    light: 'property of the light',
    terrain: 'property of the terrain',
    projection: 'property of the projection',
    transition: 'property of transitions',
};

export function registerDescribeStyleSpec(server: McpServer): void {
    server.registerTool('describe_style_spec', {
        title: 'Describe style spec',
        description: [
            'Looks up a name in the MapLibre Style Specification: a layer type (like "fill"), a layer or root property',
            '(like "fill-extrusion-height" or "sky"), a source type (like "geojson") or an expression operator',
            '(like "interpolate"). Returns its documentation, type, default, allowed values, expression support and',
            'which MapLibre GL JS and MapLibre Native versions support it. Check here before using a property you are',
            'not sure exists in MapLibre, since Mapbox GL JS has properties that MapLibre does not.',
        ].join(' '),
        inputSchema: z.object({name: z.string().describe('The name to look up.')}),
        annotations: {readOnlyHint: true},
    }, ({name}) => ({content: [{type: 'text', text: describeName(name.trim())}]}));
}

/** Returns the documentation for every part of the spec that has the name, or suggestions when none has. */
export function describeName(name: string): string {
    const sections = [
        describeLayerType(name),
        describeSourceType(name),
        describeLayerProperty(name),
        describeOtherProperty(name),
        describeRootProperty(name),
        describeLayerKey(name),
        describeExpression(name),
    ].filter(section => section !== undefined);
    return sections.length > 0 ? sections.join('\n\n') : describeUnknown(name);
}

function describeLayerType(name: string): string | undefined {
    const type = layerTypes().find(candidate => candidate === name);
    if (!type) return undefined;
    return [
        `Layer type "${type}"`,
        valueDocs(SPEC.layer.type)[type],
        'Layout properties:',
        ...listProperties(SPEC[`layout_${type}`]),
        'Paint properties:',
        ...listProperties(SPEC[`paint_${type}`]),
    ].join('\n');
}

function describeSourceType(name: string): string | undefined {
    if (!SOURCE_TYPES.includes(name)) return undefined;
    return [`Source type "${name}"`, 'Fields:', ...listProperties(SPEC[`source_${name.replace('-', '_')}`])].join('\n');
}

function describeLayerProperty(name: string): string | undefined {
    const groups = Object.keys(SPEC).filter(group => /^(layout|paint)_/.test(group) && name in SPEC[group]);
    if (groups.length === 0) return undefined;
    const kind = groups[0].startsWith('layout') ? 'layout' : 'paint';
    const types = groups.map(group => group.slice(group.indexOf('_') + 1));
    return describeEntry(name, SPEC[groups[0]][name], `${kind} property of ${types.join(', ')} layers`);
}

function describeOtherProperty(name: string): string | undefined {
    const group = Object.keys(OTHER_PROPERTY_GROUPS).find(candidate => name in SPEC[candidate]);
    if (!group) return undefined;
    return describeEntry(name, SPEC[group][name], OTHER_PROPERTY_GROUPS[group]);
}

function describeRootProperty(name: string): string | undefined {
    const entry = SPEC.$root[name];
    if (!entry) return undefined;
    const section = describeEntry(name, entry, 'root property of the style');
    const group = entry.type && entry.type in OTHER_PROPERTY_GROUPS ? SPEC[entry.type] : undefined;
    if (!group) return section;
    return [section, 'Properties:', ...listProperties(group)].join('\n');
}

function describeLayerKey(name: string): string | undefined {
    const entry = SPEC.layer[name];
    if (!entry) return undefined;
    return describeEntry(name, entry, 'property of every layer');
}

function describeExpression(name: string): string | undefined {
    const expression = EXPRESSIONS[name];
    if (!expression) return undefined;
    const lines = [`Expression "${name}"`, expression.doc ?? ''];
    for (const overload of expression.syntax?.overloads ?? []) {
        const outputs = [overload['output-type']].flat().join(' | ');
        lines.push(`Syntax: ["${name}", ${overload.parameters.join(', ')}] returns ${outputs}`);
    }
    for (const parameter of expression.syntax?.parameters ?? []) {
        lines.push(`  ${parameter.name} (${[parameter.type ?? 'any'].flat().join(' | ')}): ${parameter.doc ?? ''}`);
    }
    if (expression.example !== undefined) lines.push(`Example: ${JSON.stringify(expression.example)}`);
    lines.push(...describeSupport(expression['sdk-support']));
    return lines.filter(line => line !== '').join('\n');
}

function describeEntry(name: string, entry: SpecEntry, context: string): string {
    const facts = [
        entry.type && `Type: ${entry.type}${entry.value ? ` of ${entry.value}` : ''}${entry.length ? `, length ${entry.length}` : ''}.`,
        entry.required && 'Required.',
        entry.default !== undefined && `Default: ${JSON.stringify(entry.default)}.`,
        entry.minimum !== undefined && `Minimum: ${entry.minimum}.`,
        entry.maximum !== undefined && `Maximum: ${entry.maximum}.`,
        entry.units && `Units: ${entry.units}.`,
        entry.transition && 'Transitionable.',
    ].filter(fact => typeof fact === 'string');

    const lines = [`${name} (${context})`, entry.doc ?? ''];
    if (facts.length > 0) lines.push(facts.join(' '));
    const values = valueDocs(entry);
    if (Object.keys(values).length > 0) {
        lines.push('Values:', ...Object.entries(values).map(([value, doc]) => `  ${value}: ${doc}`));
    }
    if (entry.expression) lines.push(describeExpressionSupport(entry.expression));
    if (entry.requires?.length) lines.push(`Requires: ${entry.requires.map(requirement => JSON.stringify(requirement)).join(', ')}.`);
    if (entry.example !== undefined) lines.push(`Example: ${JSON.stringify(entry.example)}`);
    lines.push(...describeSupport(entry['sdk-support']));
    return lines.filter(line => line !== '').join('\n');
}

function describeExpressionSupport({interpolated, parameters = []}: NonNullable<SpecEntry['expression']>): string {
    const inputs = parameters.length > 0 ? `Expressions can use ${parameters.join(', ')}` : 'Expressions allowed';
    return `${inputs}${interpolated ? ', and the value can be interpolated' : ''}.`;
}

function describeSupport(support: SpecEntry['sdk-support']): string[] {
    if (!support) return [];
    return ['Support:', ...Object.entries(support).map(([feature, platforms]) => {
        const list = Object.entries(platforms).map(([platform, version]) => {
            const label = PLATFORMS[platform] ?? platform;
            return /^\d/.test(version) ? `${label} ${version}` : `${label} not yet (${version})`;
        });
        return `  ${feature}: ${list.join(', ')}`;
    })];
}

function describeUnknown(name: string): string {
    const candidates = allNames();
    const containing = candidates.filter(candidate => candidate.includes(name) && candidate !== name).slice(0, 20);
    const close = candidates
        .map(candidate => ({candidate, distance: editDistance(name, candidate)}))
        .filter(({distance}) => distance <= Math.max(1, Math.floor(name.length / 4)))
        .sort((a, b) => a.distance - b.distance)
        .map(({candidate}) => candidate)
        .slice(0, 5);
    const suggestions = [...new Set([...close, ...containing])];
    const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
    return `"${name}" is not in the MapLibre Style Specification.${hint}`;
}

function listProperties(group: SpecGroup | undefined): string[] {
    return Object.entries(group ?? {}).map(([name, entry]) => {
        const facts = [entry.type, entry.default !== undefined ? `default ${JSON.stringify(entry.default)}` : undefined];
        return `  ${name} (${facts.filter(fact => fact !== undefined).join(', ')}): ${firstSentence(entry.doc)}`;
    });
}

function valueDocs(entry: SpecEntry): Record<string, string> {
    if (!isRecord(entry.values)) return {};
    return Object.fromEntries(Object.entries(entry.values).map(([value, info]) => [value, info?.doc ?? '']));
}

function layerTypes(): string[] {
    return Object.keys(valueDocs(SPEC.layer.type));
}

function allNames(): string[] {
    const properties = Object.keys(SPEC)
        .filter(group => /^(layout|paint)_/.test(group) || group in OTHER_PROPERTY_GROUPS)
        .flatMap(group => Object.keys(SPEC[group]));
    return [...new Set([
        ...layerTypes(),
        ...SOURCE_TYPES,
        ...properties,
        ...Object.keys(SPEC.$root),
        ...Object.keys(SPEC.layer),
        ...Object.keys(EXPRESSIONS),
    ])];
}

function firstSentence(doc: string | undefined): string {
    if (!doc) return '';
    const end = doc.search(/\.(\s|$)/);
    return end === -1 ? doc : doc.slice(0, end + 1);
}

function isRecord(value: unknown): value is Record<string, {doc?: string}> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function editDistance(a: string, b: string): number {
    let previous = Array.from({length: b.length + 1}, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
            current.push(Math.min(previous[j] + 1, current[j - 1] + 1, substitution));
        }
        previous = current;
    }
    return previous[b.length];
}

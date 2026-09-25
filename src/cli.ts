import {Client} from '@modelcontextprotocol/client';
import {type CallToolResult, InMemoryTransport} from '@modelcontextprotocol/server';
import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import pkg from '../package.json' with {type: 'json'};
import {createServer} from './server.js';
import {selectToolsets} from './toolsets.js';

/** A command that runs one tool once, for agents and people in a shell. */
type Command = {
    tool: string;
    usage: string;
    description: string;
    /** Whether the command takes a style before the change and one after it, rather than one style. */
    twoStyles?: boolean;
    /** The file an image result goes to, unless `--out` names another. */
    image?: string;
    /** Whether the command takes a vector source, or a style when `--source` names one of its sources. */
    readsSource?: boolean;
};

/** Only the tools that nothing else offers on the command line; the style spec has `gl-style-validate` and friends. */
export const COMMANDS: Record<string, Command> = {
    'render': {
        tool: 'render_style', usage: 'render <style>', image: 'map.png',
        description: 'Render the style to a PNG, and report map errors and missing icons',
    },
    'compare': {
        tool: 'compare_styles', usage: 'compare <before> <after>', twoStyles: true, image: 'compare.png',
        description: 'Render two versions of a style, and mark the pixels that differ in red',
    },
    'compare-renderers': {
        tool: 'compare_renderers', usage: 'compare-renderers <style>', image: 'renderers.png',
        description: 'Render the style with two renderers, and mark the pixels that differ in red',
    },
    'describe-sources': {
        tool: 'describe_sources', usage: 'describe-sources <style>',
        description: 'List the source layers and fields, and the layers that use ones that are not there',
    },
    'debug-layers': {
        tool: 'debug_layers', usage: 'debug-layers <style>',
        description: 'Say which layers draw at a place, and why the others draw nothing',
    },
    'inspect-tile': {
        tool: 'inspect_tile', usage: 'inspect-tile <source>', readsSource: true,
        description: 'List the source layers, geometry types and field values of the vector tile at a place',
    },
};

const OPTIONS = {
    center: {type: 'string'},
    zoom: {type: 'string'},
    bearing: {type: 'string'},
    pitch: {type: 'string'},
    bounds: {type: 'string'},
    width: {type: 'string'},
    height: {type: 'string'},
    renderer: {type: 'string'},
    renderers: {type: 'string'},
    out: {type: 'string'},
    source: {type: 'string'},
    layer: {type: 'string'},
    layers: {type: 'string'},
    examples: {type: 'string'},
} as const;

type Options = {[Name in keyof typeof OPTIONS]?: string};

const STYLE_HELP = 'A style is a file or a URL.';
const SOURCE_HELP = 'A source is a TileJSON URL, a PMTiles archive or a tile URL, or a style with --source <id>.';

const NUMBER_OPTIONS = ['zoom', 'bearing', 'pitch', 'width', 'height', 'examples'] as const;
const LIST_OPTIONS = ['center', 'bounds'] as const;

export function isCommand(name: string): boolean {
    return Object.hasOwn(COMMANDS, name);
}

/** Runs a command, prints the text of the result, writes its image to a file, and resolves to the exit code. */
export async function runCommand(name: string, args: string[]): Promise<number> {
    const command = COMMANDS[name];
    const {values, positionals} = parseArgs({args, options: OPTIONS, allowPositionals: true});
    const styles = command.twoStyles ? 2 : 1;
    if (positionals.length !== styles) throw new Error(`Usage: maplibre-mcp ${command.usage}. ${command.readsSource ? SOURCE_HELP : STYLE_HELP}`);

    const target = command.readsSource ? sourceArguments(positionals[0], values.source) : styleArguments(positionals);
    const client = await connectInProcess();
    const result = await client.callTool({name: command.tool, arguments: {...target, ...toolArguments(values)}});
    const lines = await outputLines(result, values.out ?? command.image);
    for (const line of lines) (result.isError ? console.error : console.log)(line);
    return result.isError ? 1 : 0;
}

async function connectInProcess(): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer(selectToolsets('all')).connect(serverTransport);
    const client = new Client({name: 'maplibre-mcp', version: pkg.version});
    await client.connect(clientTransport);
    return client;
}

/** Takes the argument as the source, or as a style when `--source` gives the id of one of its sources. */
function sourceArguments(argument: string, source: string | undefined): Record<string, unknown> {
    return source === undefined ? {source: argument} : {...styleInput(argument), source};
}

function styleArguments(positionals: string[]): Record<string, unknown> {
    if (positionals.length === 2) return {before: styleInput(positionals[0]), after: styleInput(positionals[1])};
    return styleInput(positionals[0]);
}

/** Takes a style argument with a scheme, like `https://` or `mapbox://`, as a URL, and anything else as a file. */
function styleInput(style: string): {url: string} | {path: string} {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(style) ? {url: style} : {path: style};
}

function toolArguments(options: Options): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    for (const name of NUMBER_OPTIONS) {
        const value = options[name];
        if (value !== undefined) args[name] = toNumber(name, value);
    }
    for (const name of LIST_OPTIONS) {
        const value = options[name];
        if (value !== undefined) args[name] = value.split(',').map(item => toNumber(name, item));
    }
    if (options.layer) args.layer = options.layer;
    if (options.layers) args.layers = options.layers.split(',');
    if (options.renderer) args.renderer = options.renderer;
    if (options.renderers) args.renderers = options.renderers.split(',');
    return args;
}

function toNumber(option: string, value: string): number {
    const number = Number(value);
    if (value.trim() === '' || Number.isNaN(number)) throw new Error(`--${option} takes numbers, like --center 12.57,55.68 or --zoom 12.`);
    return number;
}

/** Returns the text of a tool result, after writing its image to a file. */
async function outputLines(result: CallToolResult, imageFile: string | undefined): Promise<string[]> {
    const lines: string[] = [];
    for (const item of result.content) {
        if (item.type === 'text') lines.push(item.text);
        if (item.type === 'image' && imageFile) {
            await writeFile(imageFile, Buffer.from(item.data, 'base64'));
            lines.push(`Wrote ${imageFile}.`);
        }
    }
    return lines;
}

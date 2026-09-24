import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

/** The parts of JSON Schema that the tool input schemas use. */
type Schema = {
    type?: string;
    description?: string;
    enum?: unknown[];
    default?: unknown;
    format?: string;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    items?: unknown;
    properties?: Record<string, unknown>;
    required?: string[];
};

type Tool = {
    name: string;
    description?: string;
    inputSchema: Schema;
};

type Section = {
    title: string;
    text: string;
    tools: string[];
};

type Parameter = {
    name: string;
    type: string;
    description: string;
};

const SERVER = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const PAGE = new URL('src/content/docs/tools.md', import.meta.url);

const INTRO = [
    'These are the tools and parameters an agent sees, taken from the server with every toolset on.',
    'The descriptions are the ones the agent reads.',
    '',
    'Tools that take a style accept it in one of three ways: as an object in `style`, as a URL in `url`,',
    'or as a file in `path`, relative to the directory the server runs in.',
].join('\n');

const SECTIONS: Section[] = [
    {
        title: 'Check styles',
        text: 'These tools are in the `style` toolset, which is on by default. `format_style` and `migrate_style` write to the file given in `path`, and the others only read.',
        tools: ['validate_style', 'describe_style_spec', 'describe_sources', 'format_style', 'migrate_style'],
    },
    {
        title: 'Render and compare',
        text: [
            'These tools come with any of the renderer toolsets, `gl-js`, `native` and `martin`.',
            'The `renderer` parameter offers the renderers that are on, with the first as the default, and `compare_renderers` needs two of them.',
            '[Rendering](/maplibre-mcp/rendering/) covers what each renderer needs.',
        ].join(' '),
        tools: ['render_style', 'compare_styles', 'compare_renderers'],
    },
    {
        title: 'Show maps',
        text: '`show_map` is in the `gl-js` toolset, which is on by default. The user sees the map in clients that support MCP Apps, like Claude and VS Code.',
        tools: ['show_map'],
    },
    {
        title: 'Martin',
        text: '`martin_list_sources` is in the `martin` toolset.',
        tools: ['martin_list_sources'],
    },
];

const tools = await listTools();
checkSections(tools);
await writeFile(PAGE, page(tools));

async function listTools(): Promise<Tool[]> {
    const client = new Client({name: 'maplibre-mcp-docs', version: '1.0.0'});
    await client.connect(new StdioClientTransport({command: process.execPath, args: [SERVER, '--toolsets', 'all']}));
    try {
        return (await client.listTools()).tools;
    } finally {
        await client.close();
    }
}

function checkSections(tools: Tool[]): void {
    const listed = new Set(SECTIONS.flatMap(section => section.tools));
    const missing = tools.filter(tool => !listed.has(tool.name)).map(tool => tool.name);
    if (missing.length > 0) throw new Error(`Add ${missing.join(', ')} to a section in site/generate-tools.ts.`);
}

function page(tools: Tool[]): string {
    const lines = [
        '---',
        'title: Tools',
        `description: ${JSON.stringify(`What ${listOf(SECTIONS.flatMap(section => section.tools), 'and', false)} do, and their parameters.`)}`,
        '---',
        '',
        INTRO,
        ...SECTIONS.flatMap(section => sectionLines(section, tools)),
    ];
    return `${lines.join('\n')}\n`;
}

function sectionLines({title, text, tools: names}: Section, tools: Tool[]): string[] {
    return ['', `## ${title}`, '', text, ...names.flatMap(name => toolLines(findTool(tools, name)))];
}

function findTool(tools: Tool[], name: string): Tool {
    const tool = tools.find(candidate => candidate.name === name);
    if (!tool) throw new Error(`The server has no tool ${name}. Remove it from site/generate-tools.ts.`);
    return tool;
}

function toolLines({name, description, inputSchema}: Tool): string[] {
    return [
        '',
        `### ${name}`,
        '',
        description ?? '',
        '',
        '| Parameter | Type | Description |',
        '| --- | --- | --- |',
        ...parameters(inputSchema, '').map(parameter => `| \`${parameter.name}\` | ${parameter.type} | ${parameter.description} |`),
    ];
}

/** Lists the properties of an object schema, followed by the properties of the objects inside them. */
function parameters(schema: Schema, prefix: string): Parameter[] {
    const required = new Set(schema.required);
    return Object.entries(schema.properties ?? {}).flatMap(([key, property]) => {
        if (!isSchema(property)) return [];
        const name = `${prefix}${key}`;
        const type = required.has(key) ? `${typeName(property)}, required` : typeName(property);
        return [{name, type, description: describe(property)}, ...nestedParameters(property, name)];
    });
}

function nestedParameters(schema: Schema, name: string): Parameter[] {
    if (schema.properties) return parameters(schema, `${name}.`);
    if (isSchema(schema.items) && schema.items.properties) return parameters(schema.items, `${name}[].`);
    return [];
}

function typeName(schema: Schema): string {
    if (schema.enum) return listOf(schema.enum, 'or');
    if (schema.format === 'uri') return 'URL';
    if (schema.type === 'array') return arrayTypeName(schema);
    if (schema.minimum !== undefined && schema.maximum !== undefined) return `${schema.type}, ${schema.minimum} to ${schema.maximum}`;
    return schema.type ?? 'any';
}

function arrayTypeName({items: itemSchema, minItems, maxItems}: Schema): string {
    const items = isSchema(itemSchema) ? itemSchema : {};
    const fixed = minItems !== undefined && minItems === maxItems;
    if (items.enum) return fixed ? `${minItems} of ${listOf(items.enum, 'and')}` : `array of ${listOf(items.enum, 'or')}`;
    const itemType = `${items.properties ? 'object' : items.type ?? 'value'}s`;
    return fixed ? `${minItems} ${itemType}` : `array of ${itemType}`;
}

function isSchema(value: unknown): value is Schema {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOf(values: unknown[], conjunction: string, code = true): string {
    const items = values.map(value => (code ? `\`${value}\`` : String(value)));
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1)}` : items.join('');
}

function describe({description, default: value}: Schema): string {
    if (value === undefined) return description ?? '';
    const shown = typeof value === 'string' ? value : JSON.stringify(value);
    return [description, `Defaults to \`${shown}\`.`].filter(Boolean).join(' ');
}

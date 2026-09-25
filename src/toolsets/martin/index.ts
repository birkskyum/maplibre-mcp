import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import type {Renderer, RenderRequest, RenderResult} from '../../render-style.js';
import {fetchJson} from '../../style-input.js';
import type {Toolset} from '../../toolsets.js';

/** The response of Martin's `/catalog` endpoint. */
type Catalog = {
    tiles?: Record<string, {name?: string; content_type?: string; content_encoding?: string; description?: string}>;
    sprites?: Record<string, {images?: string[]}>;
    fonts?: Record<string, {family?: string; style?: string}>;
    styles?: Record<string, {path?: string}>;
};

const DEFAULT_URL = 'http://localhost:3000';

/** Draws with Martin's static image endpoint, which renders the styles Martin serves with MapLibre Native. */
export const martinRenderer: Renderer = {name: 'martin', render: renderWithMartin};

export const martinToolset: Toolset = {
    name: 'martin',
    description: 'List what a Martin tile server serves, and render the styles it serves',
    register: registerListSources,
    renderer: martinRenderer,
};

function registerListSources(server: McpServer): void {
    server.registerTool('martin_list_sources', {
        title: 'List Martin sources',
        description: [
            'Lists the tile sources, sprites, fonts and styles that a Martin tile server serves,',
            'with the URLs to put in a MapLibre style. Follow up with inspect_tile on the TileJSON URL',
            'of a tile source, to see its source layers, geometry types and the values of its fields.',
        ].join(' '),
        inputSchema: z.object({
            url: z.url().optional().describe(`Base URL of the Martin server. Defaults to MARTIN_URL, or ${DEFAULT_URL}.`),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async ({url}) => {
        const base = (url ?? process.env.MARTIN_URL ?? DEFAULT_URL).replace(/\/+$/, '');
        const catalog = await fetchJson<Catalog>(`${base}/catalog`);
        return {content: [{type: 'text', text: describeCatalog(base, catalog)}]};
    });
}

function describeCatalog(base: string, {tiles = {}, sprites = {}, fonts = {}, styles = {}}: Catalog): string {
    const lines = [`Martin at ${base}`, '', 'Tile sources, with the TileJSON URL to use as the "url" of a source:'];
    for (const [id, source] of Object.entries(tiles)) {
        const details = [sourceType(source.content_type), source.content_encoding, source.name, source.description];
        lines.push(`  ${id}: ${base}/${encodeURIComponent(id)} (${details.filter(Boolean).join(', ')})`);
    }
    if (Object.keys(sprites).length > 0) {
        lines.push('', 'Sprites, to use as the "sprite" of the style:');
        for (const [id, sprite] of Object.entries(sprites)) {
            lines.push(`  ${id}: ${base}/sprite/${encodeURIComponent(id)} (${sprite.images?.length ?? 0} images)`);
        }
    }
    if (Object.keys(fonts).length > 0) {
        lines.push('', `Fonts, with "glyphs": "${base}/font/{fontstack}/{range}" in the style:`);
        lines.push(...Object.keys(fonts).map(name => `  ${name}`));
    }
    if (Object.keys(styles).length > 0) {
        lines.push('', 'Styles:');
        lines.push(...Object.keys(styles).map(id => `  ${id}: ${base}/style/${encodeURIComponent(id)}`));
    }
    return lines.join('\n');
}

function sourceType(contentType: string | undefined): string | undefined {
    if (contentType === 'application/x-protobuf') return 'vector';
    if (contentType?.startsWith('image/')) return `raster, ${contentType}`;
    return contentType;
}

async function renderWithMartin({styleUrl, camera, width, height}: RenderRequest): Promise<RenderResult> {
    const style = styleUrl ? martinStyle(styleUrl) : undefined;
    if (!style) {
        throw new Error('The martin renderer draws the styles that a Martin server serves, so pass the style as url: "<martin>/style/<id>".');
    }
    const {center: [lng, lat], zoom, bearing, pitch} = camera;
    const url = `${style.base}/style/${encodeURIComponent(style.id)}/static/${lng},${lat},${zoom}@${bearing},${pitch}/${width}x${height}.png`;
    const response = await fetch(url);
    if (response.status === 404) {
        throw new Error([
            `Martin answered 404 for ${url}. Check that Martin serves the style, and that rendering is on:`,
            'it needs a Martin build with rendering, like the -full Docker image, and "rendering: true" under "styles" in its configuration.',
        ].join(' '));
    }
    if (!response.ok) throw new Error(`Martin answered HTTP ${response.status} for ${url}: ${(await response.text()).slice(0, 300)}`);
    return {
        png: new Uint8Array(await response.arrayBuffer()),
        notes: [`Rendered by the Martin server at ${style.base}, with MapLibre Native.`],
    };
}

/** Splits a Martin style URL, like `http://localhost:3000/style/basic`, into the server's base URL and the style id. */
function martinStyle(styleUrl: string): {base: string; id: string} | undefined {
    const url = new URL(styleUrl);
    const match = /^(.*)\/style\/([^/]+)\/?$/.exec(url.pathname);
    return match ? {base: `${url.origin}${match[1]}`, id: decodeURIComponent(match[2])} : undefined;
}

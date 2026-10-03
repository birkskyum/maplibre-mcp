import {McpServer} from '@modelcontextprotocol/server';
import pkg from '../package.json' with {type: 'json'};
import {registerCompareRenderers, registerCompareStyles} from './compare-styles.js';
import {registerRenderStyle} from './render-style.js';
import type {Toolset} from './toolsets.js';

/** How to work with `render_style`, which the server has when a toolset brings a renderer. */
const RENDER_INSTRUCTIONS = [
    'A style that validates is not finished. Render it with render_style and look at the image as its user will.',
    'Is what they asked for the first thing the eye lands on? Can every label be read, and does it stand clear of the other labels and of what it names?',
    'Do lines crowd into clutter anywhere? Do the land, the relief and the lines differ enough in color and weight?',
    'Render more than one view before you call it done, such as the place that was asked for, a wider area and a closer one,',
    'because these problems often show only at another zoom. Fix what you see and render again. A first render is rarely the best the style can be.',
].join(' ');

/** Creates an MCP server with the tools of the given toolsets. */
export function createServer(toolsets: Toolset[]): McpServer {
    const renderers = toolsets.flatMap(toolset => toolset.renderer ?? []);
    const instructions = [
        'These tools check MapLibre work, so use them instead of assuming that it works.',
        ...toolsets.flatMap(toolset => toolset.instructions ?? []),
        ...(renderers.length > 0 ? [RENDER_INSTRUCTIONS] : []),
    ].join('\n\n');
    const server = new McpServer({name: 'maplibre-mcp', title: 'MapLibre', version: pkg.version}, {instructions});
    for (const toolset of toolsets) toolset.register?.(server);

    if (renderers.length > 0) {
        registerRenderStyle(server, renderers);
        registerCompareStyles(server, renderers);
    }
    if (renderers.length > 1) registerCompareRenderers(server, renderers);
    return server;
}

import {McpServer} from '@modelcontextprotocol/server';
import pkg from '../package.json' with {type: 'json'};
import {registerRenderStyle} from './render-style.js';
import type {Toolset} from './toolsets.js';

/** Creates an MCP server with the tools of the given toolsets. */
export function createServer(toolsets: Toolset[]): McpServer {
    const server = new McpServer({name: 'maplibre-mcp', title: 'MapLibre', version: pkg.version});
    for (const toolset of toolsets) toolset.register?.(server);

    const renderers = toolsets.flatMap(toolset => toolset.renderer ?? []);
    if (renderers.length > 0) registerRenderStyle(server, renderers);
    return server;
}

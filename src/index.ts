import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {parseArgs} from 'node:util';
import {createServer} from './server.js';
import {selectToolsets, TOOLSETS} from './toolsets.js';

const {values} = parseArgs({options: {toolsets: {type: 'string'}, help: {type: 'boolean'}}});

if (values.help) {
    console.log(usage());
    process.exit(0);
}

try {
    const toolsets = selectToolsets(values.toolsets ?? process.env.MAPLIBRE_MCP_TOOLSETS);
    await createServer(toolsets).connect(new StdioServerTransport());
    process.stdin.on('end', () => process.exit(0));
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

function usage(): string {
    const toolsets = TOOLSETS.map(toolset => `  ${toolset.name.padEnd(8)}${toolset.description}`);
    return [
        'Usage: maplibre-mcp [--toolsets <names>]',
        '',
        'Runs an MCP server for MapLibre on stdio.',
        '',
        'Toolsets, comma separated (default: style,gl-js; "all" enables every toolset):',
        ...toolsets,
        '',
        'MAPLIBRE_MCP_TOOLSETS works like --toolsets.',
    ].join('\n');
}

import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {parseArgs} from 'node:util';
import {serveHttp} from './http.js';
import {createServer} from './server.js';
import {selectToolsets, TOOLSETS} from './toolsets.js';

const {values} = parseArgs({options: {
    toolsets: {type: 'string'},
    http: {type: 'boolean'},
    host: {type: 'string', default: '127.0.0.1'},
    port: {type: 'string', default: '3100'},
    help: {type: 'boolean'},
}});

if (values.help) {
    console.log(usage());
    process.exit(0);
}

try {
    const toolsets = selectToolsets(values.toolsets ?? process.env.MAPLIBRE_MCP_TOOLSETS);
    if (values.http) {
        const url = await serveHttp(() => createServer(toolsets), values.host, Number(values.port));
        console.error(`maplibre-mcp is listening on ${url}`);
    } else {
        await createServer(toolsets).connect(new StdioServerTransport());
        process.stdin.on('end', () => process.exit(0));
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

function usage(): string {
    const toolsets = TOOLSETS.map(toolset => `  ${toolset.name.padEnd(8)}${toolset.description}`);
    return [
        'Usage: maplibre-mcp [--toolsets <names>] [--http [--host <address>] [--port <port>]]',
        '',
        'Runs an MCP server for MapLibre, on stdio or, with --http, over Streamable HTTP at /mcp',
        '(default address 127.0.0.1, port 3100).',
        '',
        'Toolsets, comma separated (default: style,gl-js; "all" enables every toolset):',
        ...toolsets,
        '',
        'MAPLIBRE_MCP_TOOLSETS works like --toolsets.',
    ].join('\n');
}

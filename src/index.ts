import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {parseArgs} from 'node:util';
import {COMMANDS, isCommand, runCommand} from './cli.js';
import {isLoopback, serveHttp} from './http.js';
import {createServer} from './server.js';
import {disableFileAccess} from './style-input.js';
import {selectToolsets, TOOLSETS} from './toolsets.js';

const [first, ...rest] = process.argv.slice(2);

try {
    if (first !== undefined && !first.startsWith('-')) {
        if (!isCommand(first)) throw new Error(unknownCommand(first));
        // The browser that renders with GL JS keeps the process alive, so exit once the command is done.
        process.exit(await runCommand(first, rest));
    }
    await serve();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}

async function serve(): Promise<void> {
    const {values} = parseArgs({options: {
        toolsets: {type: 'string'},
        http: {type: 'boolean'},
        host: {type: 'string', default: '127.0.0.1'},
        port: {type: 'string', default: '3100'},
        help: {type: 'boolean'},
    }});
    if (values.help) {
        console.log(usage());
        return;
    }
    const toolsets = selectToolsets(values.toolsets ?? process.env.MAPLIBRE_MCP_TOOLSETS);
    if (values.http) {
        if (!isLoopback(values.host)) disableFileAccess();
        const url = await serveHttp(() => createServer(toolsets), values.host, Number(values.port));
        console.error(`maplibre-mcp is listening on ${url}`);
    } else {
        await createServer(toolsets).connect(new StdioServerTransport());
        process.stdin.on('end', () => process.exit(0));
    }
}

function unknownCommand(name: string): string {
    return [
        `maplibre-mcp has no command "${name}". Its commands are ${Object.keys(COMMANDS).join(', ')}.`,
        'To validate, format or migrate a style, use gl-style-validate, gl-style-format and gl-style-migrate',
        'from @maplibre/maplibre-gl-style-spec.',
    ].join('\n');
}

function usage(): string {
    const toolsets = TOOLSETS.map(toolset => `  ${toolset.name.padEnd(8)}${toolset.description}`);
    const commands = Object.values(COMMANDS).map(command => `  ${command.usage.padEnd(28)}${command.description}`);
    return [
        'Usage: maplibre-mcp [--toolsets <names>] [--http [--host <address>] [--port <port>]]',
        '       maplibre-mcp <command> <style>... [options]',
        '',
        'Runs an MCP server for MapLibre, on stdio or, with --http, over Streamable HTTP at /mcp',
        '(default address 127.0.0.1, port 3100).',
        '',
        'Toolsets, comma separated (default: style,gl-js; "all" enables every toolset):',
        ...toolsets,
        '',
        'MAPLIBRE_MCP_TOOLSETS works like --toolsets.',
        '',
        'Commands, which run one tool and exit. A style is a file or a URL.',
        ...commands,
        '',
        'Options of the commands that render:',
        '  --center <lng,lat> --zoom <zoom> --bearing <degrees> --pitch <degrees>',
        '  --bounds <west,south,east,north>, to fit the map instead of --center and --zoom',
        '  --width <pixels> --height <pixels>',
        '  --renderer <gl-js|native|martin>, or --renderers <first,second> to compare',
        '  --out <file.png>, where the image goes',
        '',
        'To validate, format or migrate a style, use gl-style-validate, gl-style-format and gl-style-migrate',
        'from @maplibre/maplibre-gl-style-spec.',
    ].join('\n');
}

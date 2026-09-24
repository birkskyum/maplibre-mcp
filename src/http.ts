import {
    createMcpHandler,
    hostHeaderValidationResponse,
    localhostAllowedHostnames,
    localhostAllowedOrigins,
    type McpHttpHandler,
    type McpServer,
    originValidationResponse,
} from '@modelcontextprotocol/server';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';

const MCP_PATH = '/mcp';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-expose-headers': '*',
};

/**
 * Serves MCP over Streamable HTTP at `/mcp`, and resolves to its URL. On a loopback address, only requests from
 * localhost get through, which keeps web pages from reaching the server by DNS rebinding.
 */
export function serveHttp(createMcpServer: () => McpServer, host: string, port: number): Promise<string> {
    const handler = createMcpHandler(() => createMcpServer());
    const localOnly = LOOPBACK_HOSTS.has(host);
    const server = createServer((incoming, outgoing) => {
        respond(handler, localOnly, incoming, outgoing).catch(error => {
            if (!outgoing.headersSent) outgoing.writeHead(500);
            outgoing.end(String(error));
        });
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, host, () => {
            const address = server.address();
            const actualPort = typeof address === 'object' && address ? address.port : port;
            resolve(`http://${host.includes(':') ? `[${host}]` : host}:${actualPort}${MCP_PATH}`);
        });
    });
}

async function respond(handler: McpHttpHandler, localOnly: boolean, incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    const request = await toRequest(incoming);
    const response = rejectForeign(request, localOnly) ?? await route(handler, request);
    outgoing.writeHead(response.status, {...Object.fromEntries(response.headers), ...CORS_HEADERS});
    if (response.body) {
        for await (const chunk of response.body) outgoing.write(chunk);
    }
    outgoing.end();
}

function rejectForeign(request: Request, localOnly: boolean): Response | undefined {
    if (!localOnly) return undefined;
    return hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
        originValidationResponse(request, localhostAllowedOrigins());
}

function route(handler: McpHttpHandler, request: Request): Promise<Response> | Response {
    if (new URL(request.url).pathname !== MCP_PATH) return new Response(null, {status: 404});
    if (request.method === 'OPTIONS') return new Response(null, {status: 204});
    return handler.fetch(request);
}

async function toRequest(incoming: IncomingMessage): Promise<Request> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
        for (const item of [value ?? []].flat()) headers.append(name, item);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    return new Request(`http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`, {method: incoming.method, headers, body});
}

import {Client} from '@modelcontextprotocol/client';
import {InMemoryTransport} from '@modelcontextprotocol/server';
import {createServer as createHttpServer, type Server} from 'node:http';
import {createServer} from '../src/server.js';
import {selectToolsets} from '../src/toolsets.js';

/** Connects an MCP client to a server with the given toolsets. */
export async function connect(toolsets: string): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer(selectToolsets(toolsets)).connect(serverTransport);
    const client = new Client({name: 'test', version: '1.0.0'});
    await client.connect(clientTransport);
    return client;
}

/** Serves JSON documents by path on a local port, and resolves to the server's origin. */
export function serveJson(documents: Record<string, unknown>): Promise<{origin: string; server: Server}> {
    const server = createHttpServer((request, response) => {
        const document = documents[request.url ?? ''];
        if (document === undefined) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(document));
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (typeof address === 'object' && address) resolve({origin: `http://127.0.0.1:${address.port}`, server});
        });
    });
}

/** Returns the text of every text item in a tool result. */
export function textOf(result: {content?: unknown}): string {
    const items = Array.isArray(result.content) ? result.content : [];
    return items.filter(item => item.type === 'text').map(item => item.text).join('\n');
}

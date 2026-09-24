import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {beforeAll, describe, expect, test} from 'vitest';
import {serveHttp} from '../src/http.js';
import {createServer} from '../src/server.js';
import {selectToolsets} from '../src/toolsets.js';

describe('serveHttp', () => {
    let url: string;

    beforeAll(async () => {
        url = await serveHttp(() => createServer(selectToolsets('style')), '127.0.0.1', 0);
    });

    test('serves the tools over Streamable HTTP', async () => {
        const client = new Client({name: 'test', version: '1.0.0'});
        await client.connect(new StreamableHTTPClientTransport(new URL(url)));
        const {tools} = await client.listTools();
        expect(tools.map(tool => tool.name)).toContain('validate_style');
    });

    test('rejects requests from other origins on a loopback address', async () => {
        const response = await fetch(url, {
            method: 'POST',
            headers: {'content-type': 'application/json', origin: 'https://example.com'},
            body: '{}',
        });
        expect(response.status).toBe(403);
    });
});

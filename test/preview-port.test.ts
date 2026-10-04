import {createServer} from 'node:net';
import {beforeAll, describe, expect, test} from 'vitest';

/** Finds a port that is free, to name in the environment before the server reads it. */
function freePort(): Promise<number> {
    return new Promise(resolve => {
        const probe = createServer();
        probe.listen(0, '127.0.0.1', () => {
            const {port} = probe.address() as {port: number};
            probe.close(() => resolve(port));
        });
    });
}

describe('preview_style with MAPLIBRE_MCP_PREVIEW_PORT', () => {
    let port: number;

    beforeAll(async () => {
        port = await freePort();
        process.env.MAPLIBRE_MCP_PREVIEW_PORT = String(port);
    });

    test('gives a link on the port that a container publishes', async () => {
        const {connect, textOf} = await import('./connect.js');
        const client = await connect('gl-js');
        const text = textOf(await client.callTool({name: 'preview_style', arguments: {style: {version: 8, sources: {}, layers: []}}}));
        const [url] = /http:\/\/localhost:\d+\/preview\/[0-9a-f]+\//.exec(text) ?? [];
        expect(url).toContain(`http://localhost:${port}/preview/`);
        expect((await fetch(`${url}style.json`)).status).toBe(200);
    });
});

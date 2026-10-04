import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, test} from 'vitest';
import {disableFileAccess} from '../src/style-input.js';
import {connect, textOf} from './connect.js';

describe('disableFileAccess', () => {
    test('reads no style files', async () => {
        const file = path.join(await mkdtemp(path.join(tmpdir(), 'maplibre-mcp-')), 'style.json');
        await writeFile(file, '{"layers": [], "sources": {}, "version": 8}');
        disableFileAccess();
        const client = await connect('style');
        const result = await client.callTool({name: 'validate_style', arguments: {path: file}});
        expect(textOf(result)).toContain('This server does not read files, since other machines can reach it.');
    });

    test('has no link to give the user', async () => {
        disableFileAccess();
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'preview_style', arguments: {style: {version: 8, sources: {}, layers: []}}});
        expect(textOf(result)).toContain('This server runs on another machine than the user, so it has no link to give them.');
    });

    test('loads no pages', async () => {
        disableFileAccess();
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'render_page', arguments: {url: 'http://localhost:1/'}});
        expect(textOf(result)).toContain('This server does not load pages, since other machines can reach it.');
    });
});

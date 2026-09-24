import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, test} from 'vitest';
import {disableFileAccess} from '../src/style-input.js';
import {connect, textOf} from './connect.js';

describe('disableFileAccess', () => {
    test('leaves style files alone', async () => {
        const file = path.join(await mkdtemp(path.join(tmpdir(), 'maplibre-mcp-')), 'style.json');
        await writeFile(file, '{"layers": [], "sources": {}, "version": 8}');
        disableFileAccess();
        const client = await connect('style');
        const result = await client.callTool({name: 'format_style', arguments: {path: file}});
        expect(textOf(result)).toContain('This server does not read or write files, since other machines can reach it.');
        expect(await readFile(file, 'utf8')).toBe('{"layers": [], "sources": {}, "version": 8}');
    });
});

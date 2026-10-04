import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, test} from 'vitest';
import {connect, textOf} from './connect.js';

const style = (color: string): string => JSON.stringify({version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': color}}]});
const BACKGROUND = 'map.getStyle().layers[0].paint["background-color"]';

describe('preview_style', () => {
    test('gives a link to a map that follows the style file', async () => {
        const file = path.join(await mkdtemp(path.join(tmpdir(), 'maplibre-mcp-preview-')), 'style.json');
        await writeFile(file, style('#3366cc'));
        const client = await connect('gl-js');
        const text = textOf(await client.callTool({name: 'preview_style', arguments: {path: file}}));
        const [url] = /http:\/\/127\.0\.0\.1:\d+\/preview\/[0-9a-f]+\//.exec(text) ?? [];
        expect(text).toContain(`A map of the style is at ${url} for the user to open in a browser.`);
        expect(text).toContain(`It follows ${file} and redraws when the file changes.`);

        const first = await client.callTool({name: 'render_page', arguments: {url, script: BACKGROUND, width: 120, height: 80}});
        expect(textOf(first)).toContain('The script returned: "#3366cc"');

        // The page asks for the style every second, so a change made while it is open shows without a reload.
        const later = client.callTool({name: 'render_page', arguments: {
            url, script: `new Promise(resolve => setTimeout(resolve, 3000)).then(() => ${BACKGROUND})`, width: 120, height: 80,
        }});
        await new Promise(resolve => setTimeout(resolve, 1200));
        await writeFile(file, style('#cc3366'));
        expect(textOf(await later)).toContain('The script returned: "#cc3366"');
    }, 30_000);

    test('says what is wrong with a style it cannot read', async () => {
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'preview_style', arguments: {path: 'no-such-folder/style.json'}});
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(`There is no file at ${path.resolve('no-such-folder/style.json')}.`);
    });
});

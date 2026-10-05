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

    test('shows a style at the steep pitch it stores', async () => {
        const client = await connect('gl-js');
        const steep = {...JSON.parse(style('#3366cc')), center: [7.66, 45.98], zoom: 12, pitch: 88};
        const text = textOf(await client.callTool({name: 'preview_style', arguments: {style: steep}}));
        const [url] = /http:\/\/127\.0\.0\.1:\d+\/preview\/[0-9a-f]+\//.exec(text) ?? [];
        const page = await client.callTool({name: 'render_page', arguments: {url, width: 120, height: 80}});
        expect(textOf(page)).toContain('bearing 0, pitch 88.');
    });

    test('shows a changed style at the link it gave for a style passed as an object', async () => {
        const client = await connect('gl-js');
        const text = textOf(await client.callTool({name: 'preview_style', arguments: {style: JSON.parse(style('#225588'))}}));
        const [url] = /http:\/\/127\.0\.0\.1:\d+\/preview\/[0-9a-f]+\//.exec(text) ?? [];
        expect(text).toContain(`To show a changed style there, call preview_style with the style and link "${url}", and a page that has it open redraws.`);
        expect(text).toContain(`The other tools take ${url}style.json as url for the style that the map shows.`);
        const drawn = await client.callTool({name: 'render_style', arguments: {url: `${url}style.json`, width: 64, height: 64}});
        expect(drawn.isError).toBeFalsy();

        const open = client.callTool({name: 'render_page', arguments: {
            url, script: `new Promise(resolve => setTimeout(resolve, 3000)).then(() => ${BACKGROUND})`, width: 120, height: 80,
        }});
        await new Promise(resolve => setTimeout(resolve, 1200));
        const changed = await client.callTool({name: 'preview_style', arguments: {style: JSON.parse(style('#885522')), link: url}});
        expect(textOf(changed)).toBe(`The map at ${url} now shows this style, and a page that has it open redraws.`);
        expect(textOf(await open)).toContain('The script returned: "#885522"');

        // The first style gets a link of its own when it is shown again, since its old link now shows the changed one.
        const again = textOf(await client.callTool({name: 'preview_style', arguments: {style: JSON.parse(style('#225588'))}}));
        const [other] = /http:\/\/127\.0\.0\.1:\d+\/preview\/[0-9a-f]+\//.exec(again) ?? [];
        expect(other).not.toBe(url);
        expect(await (await fetch(`${url}style.json`)).text()).toContain('#885522');
        expect(await (await fetch(`${other}style.json`)).text()).toContain('#225588');
    }, 30_000);

    test('says when a link is not one it gave, or is the link of a file', async () => {
        const client = await connect('gl-js');
        const unknown = await client.callTool({name: 'preview_style', arguments: {style: JSON.parse(style('#225588')), link: 'http://127.0.0.1:1/preview/0123456789/'}});
        expect(unknown.isError).toBe(true);
        expect(textOf(unknown)).toContain('There is no map at http://127.0.0.1:1/preview/0123456789/');

        const file = path.join(await mkdtemp(path.join(tmpdir(), 'maplibre-mcp-preview-')), 'style.json');
        await writeFile(file, style('#3366cc'));
        const [url] = /http:\/\/127\.0\.0\.1:\d+\/preview\/[0-9a-f]+\//.exec(textOf(await client.callTool({name: 'preview_style', arguments: {path: file}}))) ?? [];
        const followed = await client.callTool({name: 'preview_style', arguments: {style: JSON.parse(style('#225588')), link: url}});
        expect(followed.isError).toBe(true);
        expect(textOf(followed)).toContain('A map of a file follows the file by itself.');
    });

    test('says what is wrong with a style it cannot read', async () => {
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'preview_style', arguments: {path: 'no-such-folder/style.json'}});
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain(`There is no file at ${path.resolve('no-such-folder/style.json')}.`);
    });
});

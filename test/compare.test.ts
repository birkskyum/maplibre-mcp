import {PNG} from 'pngjs';
import {describe, expect, test} from 'vitest';
import {connect, textOf} from './connect.js';

function background(color: string): object {
    return {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': color}}]};
}

/** Returns the width and height of the image in a tool result. */
function imageSize(result: {content?: unknown}): number[] {
    const items = Array.isArray(result.content) ? result.content : [];
    const png = PNG.sync.read(Buffer.from(items.find(item => item.type === 'image').data, 'base64'));
    return [png.width, png.height];
}

describe('compare_styles', () => {
    test('shows before, after and the differences side by side', async () => {
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'compare_styles', arguments: {
            before: {style: background('#3366cc')},
            after: {style: background('#cc3333')},
            width: 100,
            height: 64,
        }});
        expect(imageSize(result)).toEqual([316, 64]);
        expect(textOf(result)).toContain('100% of the pixels differ (6400 of 6400).');
    });

    test('says when a change does not change the map', async () => {
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'compare_styles', arguments: {
            before: {style: background('#3366cc')},
            after: {style: {...background('#3366cc'), name: 'renamed'}},
            width: 100,
            height: 64,
        }});
        expect(textOf(result)).toContain('Before and After look the same.');
    });
});

describe('compare_renderers', () => {
    test('compares MapLibre GL JS with MapLibre Native', async () => {
        const client = await connect('gl-js,native');
        const result = await client.callTool({name: 'compare_renderers', arguments: {style: background('#3366cc'), width: 100, height: 64}});
        expect(textOf(result)).toContain('gl-js and native look the same.');
    });
});

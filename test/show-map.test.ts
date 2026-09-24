import {describe, expect, test} from 'vitest';
import {connect, textOf} from './connect.js';

const SQUARE = {type: 'Polygon', coordinates: [[[12.55, 55.67], [12.6, 55.67], [12.6, 55.69], [12.55, 55.69], [12.55, 55.67]]]};

describe('show_map', () => {
    test('fits the map to the layers and markers', async () => {
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'show_map', arguments: {
            layers: [{type: 'fill', data: SQUARE}],
            markers: [{position: [12.7, 55.6]}],
        }});
        expect(result.structuredContent).toMatchObject({
            style: 'https://tiles.openfreemap.org/styles/liberty',
            camera: {bounds: [12.55, 55.6, 12.7, 55.69]},
        });
    });

    test('rejects paint properties that do not exist', async () => {
        const client = await connect('gl-js');
        const result = await client.callTool({name: 'show_map', arguments: {
            layers: [{type: 'fill', data: SQUARE, paint: {'fill-colour': 'red'}}],
        }});
        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('layers[0].paint.fill-colour: unknown property "fill-colour"');
    });

    test('serves the view with the origins it loads from', async () => {
        const client = await connect('gl-js');
        const {contents} = await client.readResource({uri: 'ui://maplibre/show-map.html'});
        expect(contents[0]._meta).toEqual({ui: {csp: {
            connectDomains: ['https://tiles.openfreemap.org'],
            resourceDomains: ['https://cdn.jsdelivr.net', 'https://tiles.openfreemap.org'],
            workerDomains: ['blob:'],
        }}});
        expect(contents[0]).toMatchObject({mimeType: 'text/html;profile=mcp-app'});
    });
});

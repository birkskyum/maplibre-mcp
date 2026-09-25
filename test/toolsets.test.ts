import {describe, expect, test} from 'vitest';
import {selectToolsets} from '../src/toolsets.js';
import {connect} from './connect.js';

describe('selectToolsets', () => {
    test('defaults to style and gl-js', () => {
        expect(selectToolsets(undefined).map(toolset => toolset.name)).toEqual(['style', 'gl-js']);
    });

    test('enables every toolset for all', () => {
        expect(selectToolsets('all').map(toolset => toolset.name)).toEqual(['style', 'gl-js', 'native', 'martin']);
    });

    test('lists the toolsets when a name is unknown', () => {
        expect(() => selectToolsets('style,maps')).toThrow('Unknown toolset "maps". The toolsets are: style, gl-js, native, martin, all.');
    });
});

describe('createServer', () => {
    test('offers one render_style tool for all renderers', async () => {
        const client = await connect('gl-js,native');
        const {tools} = await client.listTools();
        expect(tools.map(tool => tool.name)).toEqual(['show_map', 'render_style', 'compare_styles', 'compare_renderers']);
        expect(tools[1].inputSchema.properties?.renderer).toMatchObject({enum: ['gl-js', 'native'], default: 'gl-js'});
    });

    test('offers compare_renderers only with two renderers', async () => {
        const client = await connect('gl-js');
        const {tools} = await client.listTools();
        expect(tools.map(tool => tool.name)).toEqual(['show_map', 'render_style', 'compare_styles']);
    });

    test('offers no render_style without a renderer', async () => {
        const client = await connect('style');
        const {tools} = await client.listTools();
        expect(tools.map(tool => tool.name)).toEqual(['validate_style', 'describe_style_spec', 'describe_sources', 'inspect_tile', 'debug_layers', 'format_style', 'migrate_style']);
    });
});

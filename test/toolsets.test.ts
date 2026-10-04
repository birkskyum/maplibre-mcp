import {describe, expect, test} from 'vitest';
import {selectToolsets} from '../src/toolsets.js';
import {connect} from './connect.js';

describe('selectToolsets', () => {
    test('defaults to style, gl-js and ecosystem', () => {
        expect(selectToolsets(undefined).map(toolset => toolset.name)).toEqual(['style', 'gl-js', 'ecosystem']);
    });

    test('enables every toolset for all', () => {
        expect(selectToolsets('all').map(toolset => toolset.name)).toEqual(['style', 'gl-js', 'native', 'martin', 'ecosystem']);
    });

    test('lists the toolsets when a name is unknown', () => {
        expect(() => selectToolsets('style,maps')).toThrow('Unknown toolset "maps". The toolsets are: style, gl-js, native, martin, ecosystem, all.');
    });
});

describe('createServer', () => {
    test('offers one render_style tool for all renderers', async () => {
        const client = await connect('gl-js,native');
        const {tools} = await client.listTools();
        expect(tools.map(tool => tool.name)).toEqual(['describe_gl_js_api', 'show_map', 'render_page', 'preview_style', 'render_style', 'compare_styles', 'compare_renderers']);
        expect(tools[4].inputSchema.properties?.renderer).toMatchObject({enum: ['gl-js', 'native'], default: 'gl-js'});
    });

    test('offers compare_renderers only with two renderers', async () => {
        const client = await connect('gl-js');
        const {tools} = await client.listTools();
        expect(tools.map(tool => tool.name)).toEqual(['describe_gl_js_api', 'show_map', 'render_page', 'preview_style', 'render_style', 'compare_styles']);
    });

    test('tells the client how to work with the tools it has, and names no other tool', async () => {
        for (const toolsets of ['style', 'style,gl-js,ecosystem', 'all']) {
            const client = await connect(toolsets);
            const {tools} = await client.listTools();
            const named = client.getInstructions()?.match(/\b[a-z]+(_[a-z]+)+\b/g) ?? [];
            expect(named.length).toBeGreaterThan(0);
            expect(tools.map(tool => tool.name)).toEqual(expect.arrayContaining(named));
        }
    });

    test('says what the page renderer is for and how to load MapLibre GL JS only with the gl-js toolset', async () => {
        const withGlJs = (await connect('style,gl-js')).getInstructions();
        expect(withGlJs).toContain('render_page draws a page of your own');
        expect(withGlJs).toContain('preview_style gives the user a link');
        expect(withGlJs).toMatch(/import \* as maplibregl from 'https:\/\/unpkg\.com\/maplibre-gl@6\.\d+\.\d+\/dist\/maplibre-gl\.mjs'/);
        const styleOnly = (await connect('style')).getInstructions();
        expect(styleOnly).toContain('inspect_tile');
        expect(styleOnly).not.toContain('render_style');
        expect(styleOnly).not.toContain('maplibre-gl.mjs');
    });

    test('offers no render_style without a renderer', async () => {
        const client = await connect('style');
        const {tools} = await client.listTools();
        expect(tools.map(tool => tool.name)).toEqual(['validate_style', 'describe_style_spec', 'describe_sources', 'inspect_tile', 'debug_layers']);
    });
});

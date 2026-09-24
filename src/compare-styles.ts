import type {CallToolResult, McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {decodePng, diffImages, encodePng, sideBySide} from './image.js';
import {CAMERA_INPUT, type Camera, describeCamera, findRenderer, type Renderer, type RenderResult, resolveCamera} from './render-style.js';
import {loadStyle, STYLE_INPUT} from './style-input.js';

const SIZE_INPUT = {
    width: z.number().int().min(64).max(1024).default(512).describe('Width of each of the three images.'),
    height: z.number().int().min(64).max(1024).default(384),
};

/** Registers `compare_styles`, which shows what a change to a style changes on the map. */
export function registerCompareStyles(server: McpServer, renderers: Renderer[]): void {
    const names = renderers.map(renderer => renderer.name);
    server.registerTool('compare_styles', {
        title: 'Compare styles',
        description: [
            'Renders two versions of a MapLibre style at the same camera, and returns one image with the style before,',
            'the style after, and their differences in red. Use it after changing a style, to check that the change did',
            'what you meant and nothing else, at a few places and zoom levels. Pass each style as an object, a URL or a file path.',
        ].join(' '),
        inputSchema: z.object({
            before: z.object(STYLE_INPUT).describe('The style before the change.'),
            after: z.object(STYLE_INPUT).describe('The style after the change.'),
            renderer: z.enum(names).default(names[0]).describe('The MapLibre renderer to draw both with.'),
            ...CAMERA_INPUT,
            ...SIZE_INPUT,
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async input => {
        const [before, after] = await Promise.all([loadStyle(input.before), loadStyle(input.after)]);
        const camera = resolveCamera(before, input, input.width, input.height);
        const renderer = findRenderer(renderers, input.renderer);
        const size = {camera, width: input.width, height: input.height};
        const results = await Promise.all([
            renderer.render({style: before, styleUrl: input.before.url, ...size}),
            renderer.render({style: after, styleUrl: input.after.url, ...size}),
        ]);
        return comparison(results, ['Before', 'After'], camera);
    });
}

/** Registers `compare_renderers`, which shows how two MapLibre renderers draw the same style. */
export function registerCompareRenderers(server: McpServer, renderers: Renderer[]): void {
    const names = renderers.map(renderer => renderer.name);
    server.registerTool('compare_renderers', {
        title: 'Compare renderers',
        description: [
            'Renders one MapLibre style with two renderers, like MapLibre GL JS for the web and MapLibre Native for',
            'iOS and Android, and returns one image with both and their differences in red.',
            'Use it to check that a style looks the same everywhere it is used.',
        ].join(' '),
        inputSchema: z.object({
            ...STYLE_INPUT,
            renderers: z.array(z.enum(names)).length(2).default([names[0], names[1]]).describe('The two renderers to compare.'),
            ...CAMERA_INPUT,
            ...SIZE_INPUT,
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async input => {
        const style = await loadStyle(input);
        const camera = resolveCamera(style, input, input.width, input.height);
        const request = {style, styleUrl: input.url, camera, width: input.width, height: input.height, attribution: false};
        const results = await Promise.all(input.renderers.map(name => findRenderer(renderers, name).render(request)));
        return comparison(results, input.renderers, camera);
    });
}

function comparison(results: RenderResult[], labels: string[], camera: Camera): CallToolResult {
    const [first, second] = results.map(result => decodePng(result.png));
    const {diff, changed} = diffImages(first, second);
    const share = (100 * changed) / (diff.width * diff.height);
    const summary = changed === 0 ?
        `${labels[0]} and ${labels[1]} look the same.` :
        `${Number(share.toFixed(2))}% of the pixels differ (${changed} of ${diff.width * diff.height}).`;
    const notes = results.flatMap((result, index) => result.notes.map(note => `${labels[index]}: ${note}`));
    return {
        content: [
            {type: 'image', data: encodePng(sideBySide([first, second, diff])).toString('base64'), mimeType: 'image/png'},
            {type: 'text', text: [`Left to right: ${labels[0]}, ${labels[1]}, and the differences in red.`, summary, describeCamera(camera), ...notes].join('\n')},
        ],
    };
}

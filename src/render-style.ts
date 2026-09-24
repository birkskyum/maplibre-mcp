import type {StyleSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {loadStyle, STYLE_INPUT} from './style-input.js';

/** Where a renderer points the map, with every field resolved. */
export type Camera = {
    center: [number, number];
    zoom: number;
    bearing: number;
    pitch: number;
};

export type RenderRequest = {
    style: StyleSpecification;
    camera: Camera;
    width: number;
    height: number;
};

export type RenderResult = {
    png: Uint8Array;
    /** Lines for the model about the render, such as the renderer version and the errors the map reported. */
    notes: string[];
};

/** A MapLibre renderer that draws a style to a PNG. */
export type Renderer = {
    name: string;
    render: (request: RenderRequest) => Promise<RenderResult>;
};

type CameraInput = {
    center?: number[];
    zoom?: number;
    bearing?: number;
    pitch?: number;
    bounds?: number[];
};

const FIT_PADDING = 32;
const FIT_MAX_ZOOM = 18;
const TILE_SIZE = 512;

/** Registers `render_style`, which draws with any of the renderers that the enabled toolsets provide. */
export function registerRenderStyle(server: McpServer, renderers: Renderer[]): void {
    const names = renderers.map(renderer => renderer.name);
    server.registerTool('render_style', {
        title: 'Render style',
        description: [
            'Renders a MapLibre style to a PNG image, so you can see what the style looks like, for example after changing it.',
            'Also reports what the renderer noticed, such as style errors, failed requests and missing icons.',
            'Pass the style as an object, a URL or a file path.',
            'Without center, zoom or bounds, the camera stored in the style is used.',
        ].join(' '),
        inputSchema: z.object({
            ...STYLE_INPUT,
            renderer: z.enum(names).default(names[0]).describe('The MapLibre renderer to draw with.'),
            center: z.array(z.number()).length(2).optional().describe('[longitude, latitude] of the map center.'),
            zoom: z.number().min(0).max(24).optional(),
            bearing: z.number().optional().describe('Rotation in degrees, counterclockwise from north.'),
            pitch: z.number().min(0).max(85).optional().describe('Tilt in degrees from looking straight down.'),
            bounds: z.array(z.number()).length(4).optional()
                .describe('[west, south, east, north] to fit the map to, instead of center and zoom.'),
            width: z.number().int().min(64).max(2048).default(800),
            height: z.number().int().min(64).max(2048).default(600),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async input => {
        const style = await loadStyle(input);
        const renderer = renderers.find(candidate => candidate.name === input.renderer) ?? renderers[0];
        const camera = resolveCamera(style, input, input.width, input.height);
        const {png, notes} = await renderer.render({style, camera, width: input.width, height: input.height});
        return {
            content: [
                {type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png'},
                {type: 'text', text: [describeCamera(camera), ...notes].join('\n')},
            ],
        };
    });
}

/** Resolves the camera from the tool input, and falls back to the camera stored in the style. */
function resolveCamera(style: StyleSpecification, input: CameraInput, width: number, height: number): Camera {
    const bearing = input.bearing ?? style.bearing ?? 0;
    const pitch = input.pitch ?? style.pitch ?? 0;
    if (input.bounds) return {...fitBounds(input.bounds, width, height), bearing, pitch};

    const [lng, lat] = input.center ?? style.center ?? [0, 0];
    return {center: [lng, lat], zoom: input.zoom ?? style.zoom ?? 0, bearing, pitch};
}

/** Returns the center and zoom that fit Web Mercator bounds into a viewport, the same way for every renderer. */
function fitBounds([west, south, east, north]: number[], width: number, height: number): Pick<Camera, 'center' | 'zoom'> {
    const x1 = mercatorX(west);
    const x2 = mercatorX(east);
    const y1 = mercatorY(north);
    const y2 = mercatorY(south);
    const scale = Math.min(
        (width - 2 * FIT_PADDING) / ((x2 - x1) * TILE_SIZE),
        (height - 2 * FIT_PADDING) / ((y2 - y1) * TILE_SIZE),
    );
    const zoom = Math.min(Math.max(Math.log2(scale), 0), FIT_MAX_ZOOM);
    return {center: [lngFromMercatorX((x1 + x2) / 2), latFromMercatorY((y1 + y2) / 2)], zoom};
}

function mercatorX(lng: number): number {
    return (180 + lng) / 360;
}

function mercatorY(lat: number): number {
    return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
}

function lngFromMercatorX(x: number): number {
    return x * 360 - 180;
}

function latFromMercatorY(y: number): number {
    return (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
}

function describeCamera({center, zoom, bearing, pitch}: Camera): string {
    const [lng, lat] = center.map(value => Number(value.toFixed(5)));
    return `Camera: center [${lng}, ${lat}], zoom ${Number(zoom.toFixed(2))}, bearing ${bearing}, pitch ${pitch}.`;
}

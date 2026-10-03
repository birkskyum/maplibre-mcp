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

/** A camera given as where it is and what it looks at, which a renderer turns into a center, zoom, bearing and pitch. */
export type LookAt = {
    /** Longitude, latitude and altitude in metres of the camera. */
    from: [number, number, number];
    /** Longitude and latitude of the point on the ground that the camera looks at. */
    to: [number, number];
};

export type RenderRequest = {
    style: StyleSpecification;
    /** The URL the style was loaded from, for renderers that draw the styles a server hosts. */
    styleUrl?: string;
    camera: Camera;
    /** Replaces the camera, for a renderer that can place one over terrain. */
    lookAt?: LookAt;
    width: number;
    height: number;
    /** Whether to draw the map's attribution, which comparisons between renderers leave out since only GL JS draws it. */
    attribution?: boolean;
};

export type RenderResult = {
    png: Uint8Array;
    /** The camera the renderer ended up with, when it placed the camera itself. */
    camera?: Camera;
    /** Lines for the model about the render, such as the renderer version and the errors the map reported. */
    notes: string[];
};

/** A MapLibre renderer that draws a style to a PNG. */
export type Renderer = {
    name: string;
    /** Whether it can place the camera from a position and a point to look at, which takes the height of the terrain. */
    looksAt?: boolean;
    render: (request: RenderRequest) => Promise<RenderResult>;
};

type CameraInput = {
    center?: number[];
    zoom?: number;
    bearing?: number;
    pitch?: number;
    bounds?: number[];
};

/** Input fields for the camera of the tools that render. */
export const CAMERA_INPUT = {
    center: z.array(z.number()).length(2).optional().describe('[longitude, latitude] of the map center.'),
    zoom: z.number().min(0).max(24).optional(),
    bearing: z.number().optional().describe('The compass direction at the top of the map, in degrees.'),
    pitch: z.number().min(0).max(85).optional().describe('Tilt in degrees from looking straight down.'),
    bounds: z.array(z.number()).length(4).optional()
        .describe('[west, south, east, north] to fit the map to, instead of center and zoom.'),
};

/** Input fields that place the camera in space, for a view over terrain that a center and zoom are hard to guess for. */
const LOOK_AT_INPUT = {
    cameraPosition: z.array(z.number()).length(3).optional()
        .describe('[longitude, latitude, altitude in metres] of the camera, to place it in space instead of with center, zoom, bearing and pitch. Needs lookAt.'),
    lookAt: z.array(z.number()).length(2).optional()
        .describe('[longitude, latitude] of the point on the ground that the camera at cameraPosition looks at, like a summit or a village.'),
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
            'Also reports what the renderer noticed, such as style errors, failed requests, and fonts and icons that are missing.',
            'Pass the style as an object, a URL or a file path.',
            'Without center, zoom or bounds, the camera stored in the style is used.',
            'For a view over 3D terrain, cameraPosition and lookAt place the camera in space, and the result gives the center, zoom, bearing and pitch of that view to store in the style.',
        ].join(' '),
        inputSchema: z.object({
            ...STYLE_INPUT,
            renderer: z.enum(names).default(names[0]).describe('The MapLibre renderer to draw with.'),
            ...CAMERA_INPUT,
            ...LOOK_AT_INPUT,
            width: z.number().int().min(64).max(2048).default(800),
            height: z.number().int().min(64).max(2048).default(600),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async input => {
        const style = await loadStyle(input);
        const camera = resolveCamera(style, input, input.width, input.height);
        const renderer = findRenderer(renderers, input.renderer);
        const lookAt = resolveLookAt(input, renderer);
        const {png, notes, camera: placed} = await renderer
            .render({style, styleUrl: input.url, camera, lookAt, width: input.width, height: input.height});
        return {
            content: [
                {type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png'},
                {type: 'text', text: [describeCamera(placed ?? camera), ...notes].join('\n')},
            ],
        };
    });
}

export function findRenderer(renderers: Renderer[], name: string): Renderer {
    return renderers.find(renderer => renderer.name === name) ?? renderers[0];
}

/** Resolves the camera from the tool input, and falls back to the camera stored in the style. */
export function resolveCamera(style: StyleSpecification, input: CameraInput, width: number, height: number): Camera {
    const bearing = input.bearing ?? style.bearing ?? 0;
    const pitch = input.pitch ?? style.pitch ?? 0;
    if (input.bounds) return {...fitBounds(input.bounds, width, height), bearing, pitch};

    const [lng, lat] = input.center ?? style.center ?? [0, 0];
    return {center: [lng, lat], zoom: input.zoom ?? style.zoom ?? 0, bearing, pitch};
}

export function describeCamera({center, zoom, bearing, pitch}: Camera): string {
    const [lng, lat] = center.map(value => Number(value.toFixed(5)));
    const round = (value: number): number => Number(value.toFixed(2));
    return `Camera: center [${lng}, ${lat}], zoom ${round(zoom)}, bearing ${round(bearing)}, pitch ${round(pitch)}.`;
}

/** Returns the camera position and the point it looks at from the tool input, which have to come together. */
function resolveLookAt(input: {cameraPosition?: number[]; lookAt?: number[]}, renderer: Renderer): LookAt | undefined {
    if (!input.cameraPosition && !input.lookAt) return undefined;
    if (!input.cameraPosition || !input.lookAt) throw new Error('Pass cameraPosition and lookAt together.');
    if (!renderer.looksAt) {
        throw new Error(`The ${renderer.name} renderer cannot place the camera from cameraPosition and lookAt. Pass center, zoom, bearing and pitch instead.`);
    }
    const [lng, lat, altitude] = input.cameraPosition;
    return {from: [lng, lat, altitude], to: [input.lookAt[0], input.lookAt[1]]};
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

export function mercatorX(lng: number): number {
    return (180 + lng) / 360;
}

export function mercatorY(lat: number): number {
    return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
}

function lngFromMercatorX(x: number): number {
    return x * 360 - 180;
}

function latFromMercatorY(y: number): number {
    return (360 / Math.PI) * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180)) - 90;
}

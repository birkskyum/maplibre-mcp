import type {StyleSpecification} from '@maplibre/maplibre-gl-style-spec';
import {createRequire} from 'node:module';
import {encodePng} from '../../image.js';
import type {Renderer, RenderRequest, RenderResult} from '../../render-style.js';
import type {Toolset} from '../../toolsets.js';

type Native = typeof import('@maplibre/maplibre-gl-native');

type NativeResponse = {data: Uint8Array};

/** The `kind` MapLibre Native gives tile requests, whose 404 means an empty tile rather than an error. */
const TILE_KIND = 3;
const REQUEST_TIMEOUT_MS = 30_000;

/** The Ubuntu 24.04 packages with the libraries the MapLibre Native build links to. */
const LINUX_PACKAGES = ['libopengl0', 'libglx0', 'libjpeg-turbo8', 'libuv1t64', 'libx11-6', 'libxext6', 'libwebp7', 'libicu74', 'libpng16-16t64'];

const require = createRequire(import.meta.url);

export const nativeRenderer: Renderer = {name: 'native', render};

export const nativeToolset: Toolset = {
    name: 'native',
    description: 'Render styles with MapLibre Native, the engine of the iOS and Android SDKs',
    renderer: nativeRenderer,
};

async function render({style, camera, width, height}: RenderRequest): Promise<RenderResult> {
    const {native, version} = loadNative();
    const failures = new Set<string>();
    const map = new native.Map({
        ratio: 1,
        request: ({url, kind}, callback) => {
            fetchResource(url, kind).then(
                response => callback(undefined, response),
                error => {
                    failures.add(error.message);
                    callback(error);
                },
            );
        },
    });
    try {
        map.load(style);
        const pixels = await renderMap(map, {...camera, width, height});
        const notes = [`Rendered with MapLibre Native ${version}.`, ...unsupportedFeatures(style)];
        if (failures.size > 0) notes.push('Failed requests:', ...[...failures].map(failure => `  ${failure}`));
        return {png: encodePng({width, height, data: unpremultiply(pixels)}), notes};
    } finally {
        map.release();
    }
}

function loadNative(): {native: Native; version: string} {
    try {
        return {
            native: require('@maplibre/maplibre-gl-native'),
            version: require('@maplibre/maplibre-gl-native/package.json').version,
        };
    } catch (error) {
        throw loadFailure(error);
    }
}

/** Explains why MapLibre Native did not load, with the fix for each cause. */
function loadFailure(error: unknown): Error {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    if (error instanceof Error && 'code' in error && error.code === 'ERR_DLOPEN_FAILED') {
        return new Error([
            `MapLibre Native could not load a system library (${message}).`,
            `On Ubuntu 24.04, install them with "sudo apt-get install ${LINUX_PACKAGES.join(' ')}",`,
            'and on a machine without a display, run the server with xvfb-run.',
        ].join(' '));
    }
    if (message.includes('lib/node-v')) {
        return new Error([
            `The installed @maplibre/maplibre-gl-native has no build for Node.js ${process.version} (${message}).`,
            'Reinstall it with the Node.js version that runs this server. Node.js 26 needs @maplibre/maplibre-gl-native@next.',
        ].join(' '));
    }
    return new Error([
        'Rendering with MapLibre Native needs the @maplibre/maplibre-gl-native package next to maplibre-mcp, for example:',
        `npx -y -p maplibre-mcp -p @maplibre/maplibre-gl-native maplibre-mcp --toolsets style,gl-js,native (${message})`,
    ].join(' '));
}

async function fetchResource(url: string, kind: number): Promise<NativeResponse | undefined> {
    if (url.startsWith('pmtiles://')) throw new Error(`The native renderer here cannot read PMTiles yet: ${url}`);
    const response = await fetch(url, {signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
    if (response.status === 204 || (response.status === 404 && kind === TILE_KIND)) return undefined;
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return {data: new Uint8Array(await response.arrayBuffer())};
}

function renderMap(map: InstanceType<Native['Map']>, options: object): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        map.render(options, (error, pixels) => {
            if (pixels) resolve(pixels);
            else reject(error);
        });
    });
}

/** Lists what the style uses that MapLibre Native does not draw, so a difference from GL JS is not mistaken for a bug. */
function unsupportedFeatures(style: StyleSpecification): string[] {
    const notes = [];
    if (style.terrain) notes.push('MapLibre Native does not draw terrain yet, so the map is flat.');
    if (style.sky) notes.push('MapLibre Native does not draw the sky yet.');
    if (style.projection) notes.push('MapLibre Native draws Mercator, not the projection in the style (maplibre/maplibre-native#3161).');
    return notes;
}

/** MapLibre Native returns premultiplied alpha, and PNG stores straight alpha. */
function unpremultiply(pixels: Uint8Array): Uint8Array {
    for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3];
        if (alpha === 0 || alpha === 255) continue;
        for (let channel = i; channel < i + 3; channel++) {
            pixels[channel] = Math.min(255, Math.round((pixels[channel] * 255) / alpha));
        }
    }
    return pixels;
}

import {readFile} from 'node:fs/promises';
import {createServer, type ServerResponse} from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import {type Browser, chromium} from 'playwright-core';
import type {Camera, LookAt, Renderer, RenderRequest, RenderResult} from '../../render-style.js';

declare global {
    interface Window {
        maplibregl?: typeof import('maplibre-gl');
        pmtiles?: typeof import('pmtiles');
    }
}

type PageInput = {
    /** The style as JSON text, which keeps Playwright from walking the style's deep type. */
    styleJson: string;
    camera: Camera;
    lookAt?: LookAt;
    attribution: boolean;
    timeoutMs: number;
    errorGraceMs: number;
};

type PageOutcome = {
    version: string;
    /** The camera the page placed for a lookAt. */
    camera?: Camera;
    errors: string[];
    missingImages: string[];
    idle: boolean;
};

const require = createRequire(import.meta.url);

/** The MapLibre GL JS version that renders and that the map view loads. */
export const MAPLIBRE_VERSION: string = require('maplibre-gl/package.json').version;

const PLAYWRIGHT_VERSION: string = require('playwright-core/package.json').version;
const MAPLIBRE_DIST = path.dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
const PMTILES_SCRIPT = path.join(path.dirname(require.resolve('pmtiles/package.json')), 'dist/pmtiles.js');

type FailedRequest = {
    url: string;
    /** Why it failed, like HTTP 404. */
    reason: string;
};

const IDLE_TIMEOUT_MS = 30_000;
/** How long a map that reported an error still gets to finish. One whose source failed to load never does. */
const ERROR_GRACE_MS = 3000;
/** The pitch that a GL JS map allows unless its maxPitch says otherwise. */
const DEFAULT_MAX_PITCH = 60;
const MAX_ERRORS = 20;

/** Lets Chrome fall back to software WebGL on machines without a GPU. */
const CHROME_ARGS = ['--enable-unsafe-swiftshader'];

const ASSETS: Record<string, {file: string; type: string}> = {
    '/maplibre-gl.mjs': {file: path.join(MAPLIBRE_DIST, 'maplibre-gl.mjs'), type: 'text/javascript'},
    '/maplibre-gl-shared.mjs': {file: path.join(MAPLIBRE_DIST, 'maplibre-gl-shared.mjs'), type: 'text/javascript'},
    '/maplibre-gl-worker.mjs': {file: path.join(MAPLIBRE_DIST, 'maplibre-gl-worker.mjs'), type: 'text/javascript'},
    '/maplibre-gl.css': {file: path.join(MAPLIBRE_DIST, 'maplibre-gl.css'), type: 'text/css'},
    '/pmtiles.js': {file: PMTILES_SCRIPT, type: 'text/javascript'},
};

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/maplibre-gl.css">
<script src="/pmtiles.js"></script>
<script type="module">window.maplibregl = await import('/maplibre-gl.mjs');</script>
<style>html, body, #map { margin: 0; width: 100%; height: 100%; }</style>
</head>
<body><div id="map"></div></body>
</html>`;

export const glJsRenderer: Renderer = {name: 'gl-js', looksAt: true, render};

let origin: Promise<string> | undefined;
let browser: Promise<Browser> | undefined;

async function render({style, camera, lookAt, width, height, attribution = true}: RenderRequest): Promise<RenderResult> {
    const [pageOrigin, instance] = await Promise.all([assetOrigin(), getBrowser()]);
    const page = await instance.newPage({viewport: {width, height}});
    const failed: FailedRequest[] = [];
    page.on('response', response => {
        if (response.status() >= 400) failed.push({url: response.url(), reason: `HTTP ${response.status()}`});
    });
    page.on('requestfailed', request => failed.push({url: request.url(), reason: request.failure()?.errorText ?? 'no answer'}));
    try {
        await page.goto(pageOrigin);
        await page.waitForFunction(() => window.maplibregl !== undefined);
        const outcome = await page.evaluate(renderInPage, {
            styleJson: JSON.stringify(style), camera, lookAt, attribution, timeoutMs: IDLE_TIMEOUT_MS, errorGraceMs: ERROR_GRACE_MS,
        });
        return {
            png: await page.screenshot({type: 'png'}),
            camera: outcome.camera,
            failed: outcome.errors.length > 0 || !outcome.idle,
            notes: [...describeOutcome(outcome), ...describeMissingFonts(style.glyphs, failed)],
        };
    } finally {
        await page.close();
    }
}

/** Draws the style in the page and waits until the map is idle. Runs in the browser, so it can only use its arguments. */
async function renderInPage({styleJson, camera, lookAt, attribution, timeoutMs, errorGraceMs}: PageInput): Promise<PageOutcome> {
    const {maplibregl, pmtiles} = window;
    if (!maplibregl) throw new Error('MapLibre GL JS did not load in the page.');
    if (pmtiles) maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);

    const errors = new Set<string>();
    const missingImages = new Set<string>();
    const map = new maplibregl.Map({
        container: 'map',
        style: JSON.parse(styleJson),
        ...camera,
        maxPitch: lookAt ? 180 : 85,
        fadeDuration: 0,
        attributionControl: attribution ? {compact: true} : false,
    });
    let lastError = 0;
    map.on('error', event => {
        const sourceId = (event as {sourceId?: string}).sourceId;
        errors.add(`${sourceId ? `Source "${sourceId}": ` : ''}${event.error.message}`);
        lastError = Date.now();
    });
    map.on('styleimagemissing', event => missingImages.add(event.id));

    const untilIdle = (): Promise<boolean> => new Promise(resolve => {
        map.once('idle', () => resolve(true));
        setTimeout(() => resolve(false), timeoutMs);
        const gaveUp = setInterval(() => {
            if (lastError === 0 || Date.now() - lastError < errorGraceMs) return;
            clearInterval(gaveUp);
            resolve(false);
        }, 250);
    });
    let idle = await untilIdle();
    if (!lookAt) return {version: maplibregl.getVersion(), errors: [...errors], missingImages: [...missingImages], idle};

    // The point looked at lies on the terrain, whose height is only known once its tiles are there, so the camera is placed again as they load.
    const [lng, lat, altitude] = lookAt.from;
    for (let pass = 0; pass < 3 && idle; pass++) {
        map.jumpTo(map.calculateCameraOptionsFromTo(new maplibregl.LngLat(lng, lat), altitude, new maplibregl.LngLat(lookAt.to[0], lookAt.to[1])));
        idle = await untilIdle();
    }
    const placed: Camera = {center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch()};
    return {version: maplibregl.getVersion(), camera: placed, errors: [...errors], missingImages: [...missingImages], idle};
}

function describeOutcome({version, camera, errors, missingImages, idle}: PageOutcome): string[] {
    const notes = [`Rendered with MapLibre GL JS ${version}.`];
    if (camera && camera.pitch > DEFAULT_MAX_PITCH) {
        notes.push(`A map shows this view only with maxPitch ${Math.ceil(camera.pitch)} or more, since its default is ${DEFAULT_MAX_PITCH}.`);
    }
    if (!idle && errors.length === 0) notes.push(`The map did not finish loading within ${IDLE_TIMEOUT_MS / 1000} seconds, so the image may be incomplete.`);
    if (errors.length > 0) {
        notes.push('Errors from the map:', ...errors.slice(0, MAX_ERRORS).map(error => `  ${error}`));
        if (errors.length > MAX_ERRORS) notes.push(`  and ${errors.length - MAX_ERRORS} more.`);
    }
    if (missingImages.length > 0) notes.push(`Images the style uses but the sprite lacks: ${missingImages.join(', ')}.`);
    return notes;
}

/**
 * Names the font stacks whose glyphs did not load. The map reports none of them as an error: MapLibre GL JS warns in
 * the console and draws their text with local fonts, so the image looks right for a font the glyph server lacks.
 * debug_layers says the same per layer.
 */
function describeMissingFonts(glyphs: string | undefined, failed: FailedRequest[]): string[] {
    if (!glyphs || !URL.canParse(glyphs)) return [];
    // The glyphs URL as the browser requests it, with a pattern in place of each of its two tokens.
    const requested = new URL(glyphs.replace('{fontstack}', 'FONTSTACK').replace('{range}', 'RANGE')).href
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace('FONTSTACK', '([^/?#]+)')
        .replace('RANGE', '\\d+-\\d+');
    const pattern = new RegExp(`^${requested}$`);
    const fonts = new Map<string, string>();
    for (const {url, reason} of failed) {
        const fontstack = pattern.exec(url)?.[1];
        if (fontstack && (!fonts.has(fontstack) || reason.startsWith('HTTP'))) fonts.set(fontstack, reason);
    }
    if (fonts.size === 0) return [];
    const stacks = [...fonts].map(([fontstack, reason]) => `"${decodeURIComponent(fontstack)}" (${reason})`);
    return [`Glyphs did not load for these font stacks, so their text is drawn with local fonts: ${stacks.join(', ')}.`];
}

/** Answers a request for a path, or leaves it to the next route by resolving to false. */
type Route = (pathname: string, response: ServerResponse) => Promise<boolean>;

const routes: Route[] = [];

/** Lets another tool serve its pages next to MapLibre GL JS, from the same local server. */
export function addRoute(route: Route): void {
    routes.push(route);
}

/** The origin of the local server that has MapLibre GL JS, which starts on first use. */
export function assetOrigin(): Promise<string> {
    origin ??= serveAssets();
    return origin;
}

/** Serves MapLibre GL JS to the headless browser from this package's own dependency. */
function serveAssets(): Promise<string> {
    const server = createServer(async (request, response) => {
        const {pathname} = new URL(request.url ?? '/', 'http://localhost');
        if (pathname === '/') {
            response.writeHead(200, {'content-type': 'text/html'}).end(PAGE);
            return;
        }
        const asset = ASSETS[pathname];
        if (asset) {
            response.writeHead(200, {'content-type': asset.type}).end(await readFile(asset.file));
            return;
        }
        for (const route of routes) {
            if (await route(pathname, response)) return;
        }
        response.writeHead(404).end();
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.unref();
            const address = server.address();
            if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
        });
    });
}

export function getBrowser(): Promise<Browser> {
    browser ??= launchBrowser().catch(error => {
        browser = undefined;
        throw error;
    });
    return browser;
}

/** Launches the installed Chrome, or else the Chromium that Playwright downloads. */
async function launchBrowser(): Promise<Browser> {
    const failures: string[] = [];
    for (const channel of ['chrome', undefined]) {
        try {
            return await chromium.launch({channel, args: CHROME_ARGS});
        } catch (error) {
            failures.push(error instanceof Error ? error.message.split('\n')[0] : String(error));
        }
    }
    throw new Error([
        'Rendering with MapLibre GL JS needs Google Chrome or the Chromium that Playwright installs.',
        `Install Chrome, or run: npx playwright-core@${PLAYWRIGHT_VERSION} install chromium`,
        `(${failures.join('; ')})`,
    ].join(' '));
}

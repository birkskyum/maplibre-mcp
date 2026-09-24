import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import {type Browser, chromium} from 'playwright-core';
import type {Camera, Renderer, RenderRequest, RenderResult} from '../../render-style.js';

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
    timeoutMs: number;
};

type PageOutcome = {
    version: string;
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

const IDLE_TIMEOUT_MS = 30_000;
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

export const glJsRenderer: Renderer = {name: 'gl-js', render};

let origin: Promise<string> | undefined;
let browser: Promise<Browser> | undefined;

async function render({style, camera, width, height}: RenderRequest): Promise<RenderResult> {
    origin ??= serveAssets();
    const [pageOrigin, instance] = await Promise.all([origin, getBrowser()]);
    const page = await instance.newPage({viewport: {width, height}});
    try {
        await page.goto(pageOrigin);
        await page.waitForFunction(() => window.maplibregl !== undefined);
        const outcome = await page.evaluate(renderInPage, {styleJson: JSON.stringify(style), camera, timeoutMs: IDLE_TIMEOUT_MS});
        return {png: await page.screenshot({type: 'png'}), notes: describeOutcome(outcome)};
    } finally {
        await page.close();
    }
}

/** Draws the style in the page and waits until the map is idle. Runs in the browser, so it can only use its arguments. */
async function renderInPage({styleJson, camera, timeoutMs}: PageInput): Promise<PageOutcome> {
    const {maplibregl, pmtiles} = window;
    if (!maplibregl) throw new Error('MapLibre GL JS did not load in the page.');
    if (pmtiles) maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);

    const errors = new Set<string>();
    const missingImages = new Set<string>();
    const map = new maplibregl.Map({
        container: 'map',
        style: JSON.parse(styleJson),
        ...camera,
        maxPitch: 85,
        fadeDuration: 0,
        attributionControl: {compact: true},
    });
    map.on('error', event => errors.add(event.error.message));
    map.on('styleimagemissing', event => missingImages.add(event.id));

    const idle = await new Promise<boolean>(resolve => {
        map.once('idle', () => resolve(true));
        setTimeout(() => resolve(false), timeoutMs);
    });
    return {version: maplibregl.getVersion(), errors: [...errors], missingImages: [...missingImages], idle};
}

function describeOutcome({version, errors, missingImages, idle}: PageOutcome): string[] {
    const notes = [`Rendered with MapLibre GL JS ${version}.`];
    if (!idle) notes.push(`The map did not finish loading within ${IDLE_TIMEOUT_MS / 1000} seconds, so the image may be incomplete.`);
    if (errors.length > 0) {
        notes.push('Errors from the map:', ...errors.slice(0, MAX_ERRORS).map(error => `  ${error}`));
        if (errors.length > MAX_ERRORS) notes.push(`  and ${errors.length - MAX_ERRORS} more.`);
    }
    if (missingImages.length > 0) notes.push(`Images the style uses but the sprite lacks: ${missingImages.join(', ')}.`);
    return notes;
}

/** Serves MapLibre GL JS to the headless browser from this package's own dependency. */
function serveAssets(): Promise<string> {
    const server = createServer(async (request, response) => {
        if (request.url === '/') {
            response.writeHead(200, {'content-type': 'text/html'}).end(PAGE);
            return;
        }
        const asset = ASSETS[request.url ?? ''];
        if (!asset) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {'content-type': asset.type}).end(await readFile(asset.file));
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

function getBrowser(): Promise<Browser> {
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

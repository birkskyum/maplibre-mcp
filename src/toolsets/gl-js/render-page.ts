import type {McpServer} from '@modelcontextprotocol/server';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import path from 'node:path';
import type {Page} from 'playwright-core';
import {z} from 'zod';
import {type Camera, describeCamera} from '../../render-style.js';
import {hasFileAccess, missingFile} from '../../style-input.js';
import {getBrowser} from './renderer.js';

declare global {
    interface Window {
        /** The map of a page, where the page keeps it for others to reach. */
        map?: import('maplibre-gl').Map;
    }
}

type PageMap = {
    version: string;
    camera: Camera;
    /** Whether the map drew everything before the time ran out. */
    idle: boolean;
};

const LOAD_TIMEOUT_MS = 30_000;
/** How long a page gets to put its map in `window.map`, which a module script does after its imports have loaded. */
const MAP_TIMEOUT_MS = 5000;
const MAX_LINES = 15;
const MAX_RETURNED = 2000;

const TYPES: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.pbf': 'application/x-protobuf', '.mvt': 'application/vnd.mapbox-vector-tile', '.woff2': 'font/woff2',
};

/** Registers `render_page`, which draws a page of the agent's own, with whatever the page adds to its map. */
export function registerRenderPage(server: McpServer): void {
    server.registerTool('render_page', {
        title: 'Render page',
        description: [
            'Loads a web page with a MapLibre map in a headless browser and returns a screenshot of it,',
            'so you can see a map together with the plugins, controls and code of its page, which render_style leaves out since a style cannot hold them.',
            'Also reports the errors and warnings of the page, the requests that failed and the camera of the map.',
            'Pass an HTML file, which is served together with the files in its folder, or the URL of a page.',
            'A page that keeps its map in window.map is drawn once that map has loaded everything, and script can then use the map, for example to move the camera before the screenshot.',
        ].join(' '),
        inputSchema: z.object({
            path: z.string().optional().describe('Path to an HTML file, relative to the directory the server runs in. The page can load the files next to it.'),
            url: z.url().optional().describe('URL of a page, for example on a development server.'),
            script: z.string().optional().describe('JavaScript to run in the page before the screenshot, like map.jumpTo({center: [7.66, 45.98], zoom: 12}). What it evaluates to is returned.'),
            width: z.number().int().min(64).max(2048).default(800),
            height: z.number().int().min(64).max(2048).default(600),
        }),
        annotations: {readOnlyHint: true, openWorldHint: true},
    }, async input => {
        if ((input.path === undefined) === (input.url === undefined)) throw new Error('Pass exactly one of path and url.');
        if (!hasFileAccess()) throw new Error('This server does not load pages, since other machines can reach it. Draw the style with render_style instead.');
        const folder = input.path === undefined ? undefined : await serveFolder(input.path);
        try {
            const {png, notes} = await renderPage(folder?.url ?? input.url ?? '', input.script, input.width, input.height);
            return {
                content: [
                    {type: 'image', data: Buffer.from(png).toString('base64'), mimeType: 'image/png'},
                    {type: 'text', text: notes.join('\n')},
                ],
            };
        } finally {
            folder?.server.close();
        }
    });
}

async function renderPage(url: string, script: string | undefined, width: number, height: number): Promise<{png: Uint8Array; notes: string[]}> {
    const page = await (await getBrowser()).newPage({viewport: {width, height}});
    const errors = new Set<string>();
    const warnings = new Set<string>();
    const failed = new Set<string>();
    page.on('console', message => {
        // Chrome logs each failed request as an error without its URL, and those are listed with their URLs below.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.add(message.text());
        if (message.type() === 'warning') warnings.add(message.text());
    });
    page.on('pageerror', error => errors.add(error.message));
    page.on('response', response => {
        if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failed.add(`HTTP ${response.status()} ${response.url()}`);
    });
    page.on('requestfailed', request => {
        // A map cancels the requests for tiles it no longer needs, which is no failure.
        const reason = request.failure()?.errorText ?? 'no answer';
        if (reason !== 'net::ERR_ABORTED') failed.add(`${reason} ${request.url()}`);
    });
    try {
        await page.goto(url, {waitUntil: 'load', timeout: LOAD_TIMEOUT_MS});
        const hasMap = await page.waitForFunction(() => typeof window.map?.loaded === 'function', undefined, {timeout: MAP_TIMEOUT_MS})
            .then(() => true, () => false);
        const notes: string[] = [];
        let map = hasMap ? await page.evaluate(untilMapIsIdle, LOAD_TIMEOUT_MS) : await untilPageIsQuiet(page);
        if (script !== undefined) {
            const returned = await page.evaluate(script).then(describeReturned, (error: Error) => `The script failed: ${error.message.split('\n')[0]}`);
            if (returned) notes.push(returned);
            map = hasMap ? await page.evaluate(untilMapIsIdle, LOAD_TIMEOUT_MS) : await untilPageIsQuiet(page);
        }
        if (map) {
            notes.unshift(describeCamera(map.camera), `Rendered with MapLibre GL JS ${map.version}.`);
            if (!map.idle) notes.push(`The map did not finish loading within ${LOAD_TIMEOUT_MS / 1000} seconds, so the image may be incomplete.`);
        } else {
            notes.unshift('The page keeps no map in window.map, so the screenshot was taken once the page stopped loading, and the camera is not known.');
        }
        notes.push(...listed('Errors in the page:', errors), ...listed('Warnings in the page:', warnings), ...listed('Requests that failed:', failed));
        return {png: await page.screenshot({type: 'png'}), notes};
    } finally {
        await page.close();
    }
}

/** Waits until the map in `window.map` has drawn everything, and returns its camera. Runs in the browser, so it can only use its arguments. */
async function untilMapIsIdle(timeoutMs: number): Promise<PageMap | undefined> {
    const {map} = window;
    if (!map) return undefined;
    const idle = await new Promise<boolean>(resolve => {
        map.once('idle', () => resolve(true));
        map.triggerRepaint();
        setTimeout(() => resolve(false), timeoutMs);
    });
    return {
        version: map.version,
        camera: {center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch()},
        idle,
    };
}

/** Waits until a page without a reachable map has stopped loading, which is the best sign there is that its map is drawn. */
async function untilPageIsQuiet(page: Page): Promise<undefined> {
    await page.waitForLoadState('networkidle', {timeout: LOAD_TIMEOUT_MS}).catch(() => undefined);
    await page.waitForTimeout(500);
    return undefined;
}

function describeReturned(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    const json = JSON.stringify(value) ?? String(value);
    return `The script returned: ${json.length > MAX_RETURNED ? `${json.slice(0, MAX_RETURNED)}…` : json}`;
}

function listed(title: string, lines: Set<string>): string[] {
    if (lines.size === 0) return [];
    const shown = [...lines].slice(0, MAX_LINES).map(line => `  ${line.split('\n')[0]}`);
    return [title, ...shown, ...(lines.size > MAX_LINES ? [`  and ${lines.size - MAX_LINES} more.`] : [])];
}

/** Serves the folder of an HTML file on a local port, so the page can load the files next to it as it would on a web server. */
async function serveFolder(file: string): Promise<{url: string; server: Server}> {
    const html = path.resolve(file);
    if (!await isFile(html)) throw new Error(missingFile(file));
    const root = path.dirname(html);
    const server = createServer(async (request, response) => {
        const {pathname} = new URL(request.url ?? '/', 'http://localhost');
        const target = path.join(root, decodeURIComponent(pathname));
        if (!target.startsWith(root + path.sep) || !await isFile(target)) {
            response.writeHead(404).end();
            return;
        }
        const {size} = await stat(target);
        const type = TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
        // PMTiles archives are read in ranges.
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
        if (range) {
            const start = Number(range[1]);
            const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            response.writeHead(206, {'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes'});
            createReadStream(target, {start, end}).pipe(response);
            return;
        }
        response.writeHead(200, {'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-store'});
        createReadStream(target).pipe(response);
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.unref();
            const address = server.address();
            if (typeof address === 'object' && address) resolve({url: `http://127.0.0.1:${address.port}/${encodeURIComponent(path.basename(html))}`, server});
        });
    });
}

async function isFile(file: string): Promise<boolean> {
    return stat(file).then(stats => stats.isFile(), () => false);
}

import type {McpServer} from '@modelcontextprotocol/server';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {hasFileAccess, loadStyle, STYLE_INPUT} from '../../style-input.js';
import {addRoute, assetOrigin} from './renderer.js';

/** A style that the local server shows as a map, read again from its file on every request. */
type Preview = {
    title: string;
    /** The file that the map follows. */
    file?: string;
    /** The style as JSON text, when it was given as an object. */
    json?: string;
    /** The URL that the map loads the style from itself. */
    url?: string;
};

const previews = new Map<string, Preview>();

addRoute(async (pathname, response) => {
    const [, id, file] = /^\/preview\/([0-9a-f]+)\/(style\.json)?$/.exec(pathname) ?? [];
    const preview = previews.get(id);
    if (!preview) return false;
    if (!file) {
        response.writeHead(200, {'content-type': 'text/html'}).end(page(preview));
        return true;
    }
    const json = preview.file ? await readFile(preview.file, 'utf8').catch(() => undefined) : preview.json;
    if (json === undefined) return false;
    response.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(json);
    return true;
});

/** Registers `preview_style`, which gives the user a map of a style to open, instead of a page and a web server of the agent's own. */
export function registerPreviewStyle(server: McpServer): void {
    server.registerTool('preview_style', {
        title: 'Preview style',
        description: [
            'Gives the user a link to an interactive map of a style, served by this server on their machine,',
            'so there is no viewer page to write, no web server to start and no browser to open for them.',
            'Given a file, the map follows it and redraws when the file changes.',
            'Pass the style as an object, a URL or a file path.',
        ].join(' '),
        inputSchema: z.object(STYLE_INPUT),
        annotations: {readOnlyHint: true, openWorldHint: false},
    }, async input => {
        if (!hasFileAccess()) throw new Error('This server runs on another machine than the user, so it has no link to give them. Send them the style instead.');
        // Reading the style now says what is wrong with it here, and not later in the page.
        const style = await loadStyle(input);
        const preview: Preview = input.path !== undefined ?
            {title: path.basename(input.path), file: path.resolve(input.path)} :
            input.url !== undefined ? {title: input.url, url: input.url} : {title: style.name ?? 'Style', json: JSON.stringify(style)};
        const id = createHash('sha1').update(preview.file ?? preview.url ?? preview.json ?? '').digest('hex').slice(0, 10);
        previews.set(id, preview);
        const lines = [`A map of the style is at ${await assetOrigin()}/preview/${id}/ for the user to open in a browser.`];
        if (preview.file) lines.push(`It follows ${preview.file} and redraws when the file changes.`);
        lines.push('The link works for as long as this server runs.');
        return {content: [{type: 'text', text: lines.join('\n')}]};
    });
}

/** The page that shows a style as a map, with the errors of the map on top of it, since a blank map says nothing. */
function page({title, url}: Preview): string {
    const escaped = title.replace(/[&<>"]/g, character => `&#${character.charCodeAt(0)};`);
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escaped}</title>
<link rel="stylesheet" href="/maplibre-gl.css">
<script src="/pmtiles.js"></script>
<style>
html, body, #map { margin: 0; height: 100%; }
#errors { position: absolute; left: 10px; bottom: 34px; max-width: 70%; padding: 8px 12px; border-radius: 6px; background: rgba(160, 0, 30, 0.92); color: #fff; font: 13px/1.4 system-ui, sans-serif; white-space: pre-wrap; display: none; }
</style>
</head>
<body>
<div id="map"></div>
<div id="errors"></div>
<script type="module">
import * as maplibregl from '/maplibre-gl.mjs';
if (window.pmtiles) maplibregl.addProtocol('pmtiles', new window.pmtiles.Protocol().tile);

const remote = ${JSON.stringify(url ?? null)};
const box = document.getElementById('errors');
const errors = new Set();
function report(message) {
    errors.add(message);
    box.textContent = [...errors].join('\\n');
    box.style.display = 'block';
}
const read = () => fetch('style.json').then(response => response.ok ? response.text() : undefined, () => undefined);

// A camera that render_style placed can be steeper than a map allows by default, so the map allows the pitch that its style stores.
const maxPitch = style => Math.max(85, Math.ceil(style?.pitch ?? 0));
let text = remote ? undefined : await read();
const first = remote ? undefined : JSON.parse(text);
const map = new maplibregl.Map({container: 'map', style: remote ?? first, hash: true, maxPitch: maxPitch(first)});
window.map = map;
map.addControl(new maplibregl.NavigationControl({visualizePitch: true}));
map.on('error', event => report(event.error.message));

// The map follows the style, so the page shows each change without a reload.
if (!remote) setInterval(async () => {
    const next = await read();
    if (next === undefined || next === text) return;
    text = next;
    errors.clear();
    box.style.display = 'none';
    try {
        const style = JSON.parse(next);
        map.setMaxPitch(maxPitch(style));
        map.setStyle(style, {diff: true});
    } catch (error) {
        report(error.message);
    }
}, 1000);
</script>
</body>
</html>`;
}

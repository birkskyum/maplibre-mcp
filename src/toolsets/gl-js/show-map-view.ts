import {App} from '@modelcontextprotocol/ext-apps/app-with-deps';
import type {IControl, Map as MapLibreMap} from 'maplibre-gl';
import type {MapPayload} from './show-map.js';

const INLINE_HEIGHT = '480px';

/** Layer types drawn above the basemap labels. The others go below them, so the labels stay readable. */
const LABEL_TYPES = new Set(['symbol', 'circle']);

const app = new App({name: 'MapLibre map', version: '1.0.0'});
let map: MapLibreMap | undefined;

app.ontoolresult = result => {
    if (result.structuredContent) showMap(result.structuredContent as MapPayload).catch(reportError);
};
app.onhostcontextchanged = applyDisplayMode;
await app.connect();
applyDisplayMode();

async function showMap(payload: MapPayload): Promise<void> {
    const url = document.querySelector<HTMLLinkElement>('link[rel="modulepreload"]')?.href;
    if (!url) throw new Error('The page does not link MapLibre GL JS.');
    const maplibregl: typeof import('maplibre-gl') = await import(url);

    map?.remove();
    const instance = new maplibregl.Map({
        container: 'map',
        style: payload.style,
        ...payload.camera,
        fitBoundsOptions: {padding: 48, maxZoom: 15},
    });
    map = instance;
    instance.addControl(new maplibregl.NavigationControl());
    if (app.getHostContext()?.availableDisplayModes?.includes('fullscreen')) instance.addControl(fullscreenControl());
    instance.on('error', event => reportError(event.error));
    instance.once('load', () => {
        const labels = topLabelLayer(instance.getStyle().layers);
        for (const [id, source] of Object.entries(payload.sources)) instance.addSource(id, source);
        for (const layer of payload.layers) instance.addLayer(layer, LABEL_TYPES.has(layer.type) ? undefined : labels);
    });
    for (const {position, label, color} of payload.markers) {
        const marker = new maplibregl.Marker({color}).setLngLat(position).addTo(instance);
        if (label) marker.setPopup(new maplibregl.Popup({offset: 24}).setText(label));
    }
}

/**
 * Returns the first layer of the labels at the top of the basemap. Basemaps like OpenFreeMap Liberty put
 * symbol layers such as one-way arrows among their roads, and data below those would be drawn under the roads.
 */
function topLabelLayer(layers: {id: string; type: string}[]): string | undefined {
    return layers[layers.findLastIndex(layer => layer.type !== 'symbol') + 1]?.id;
}

/** A map control that asks the host to show the map fullscreen, or inline again. */
function fullscreenControl(): IControl {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Toggle fullscreen';
    button.className = 'maplibregl-ctrl-fullscreen';
    button.innerHTML = '<span class="maplibregl-ctrl-icon" aria-hidden="true"></span>';
    button.addEventListener('click', () => {
        const mode = app.getHostContext()?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
        app.requestDisplayMode({mode}).catch(reportError);
    });

    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    container.append(button);
    return {onAdd: () => container, onRemove: () => container.remove()};
}

function applyDisplayMode(): void {
    const fullscreen = app.getHostContext()?.displayMode === 'fullscreen';
    document.querySelector<HTMLElement>('#map')?.style.setProperty('height', fullscreen ? '100vh' : INLINE_HEIGHT);
    document.querySelector('.maplibregl-ctrl-fullscreen, .maplibregl-ctrl-shrink')
        ?.setAttribute('class', fullscreen ? 'maplibregl-ctrl-shrink' : 'maplibregl-ctrl-fullscreen');
    map?.resize();
}

/** Shows the latest error on the map, and logs every error to the host. */
function reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    app.sendLog({level: 'error', data: message}).catch(() => undefined);
    errorBox().textContent = message;
}

function errorBox(): HTMLElement {
    const existing = document.querySelector<HTMLElement>('#error');
    if (existing) return existing;
    const box = document.createElement('div');
    box.id = 'error';
    box.style.cssText = 'position:absolute;left:8px;bottom:8px;max-width:70%;padding:4px 8px;background:#fff;color:#b00;font:12px sans-serif;border-radius:4px;';
    document.body.style.position = 'relative';
    document.body.append(box);
    return box;
}

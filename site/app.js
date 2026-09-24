const MAPLIBRE_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.11.2/dist/maplibre-gl.mjs';
const BASEMAP = 'https://tiles.openfreemap.org/styles/liberty';
const WORD_DELAY = 30;
const TOOL_DELAY = 800;
const STEP_PAUSE = 500;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** `?replay` shows only the session, playing, for recording it as a video. */
const REPLAY_ONLY = new URLSearchParams(location.search).has('replay');

const TOOL_CARD = 'rounded-lg border border-slate-200 bg-slate-50 text-sm dark:border-slate-700 dark:bg-slate-900';
const CODE = 'whitespace-pre-wrap break-words font-mono text-xs text-slate-700 dark:text-slate-300';

class Cancelled extends Error {}

setUpCopyButtons();
setUpReplay();
setUpLiveMap();

function setUpCopyButtons() {
    for (const button of document.querySelectorAll('[data-copy]')) {
        button.addEventListener('click', async () => {
            await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
            button.textContent = 'Copied';
            setTimeout(() => { button.textContent = 'Copy'; }, 1500);
        });
    }
}

async function setUpReplay() {
    const container = document.getElementById('replay');
    const session = await (await fetch('session.json')).json();
    const pauseButton = document.getElementById('replay-pause');
    let run = {cancelled: false, paused: false};

    function start() {
        run.cancelled = true;
        run = {cancelled: false, paused: false};
        pauseButton.textContent = 'Pause';
        play(session, container, run).catch(error => {
            if (!(error instanceof Cancelled)) throw error;
        });
    }

    pauseButton.addEventListener('click', () => {
        run.paused = !run.paused;
        pauseButton.textContent = run.paused ? 'Play' : 'Pause';
    });
    document.getElementById('replay-restart').addEventListener('click', start);

    if (REPLAY_ONLY) {
        for (const element of document.querySelectorAll('[data-page]')) element.remove();
        container.classList.replace('h-[36rem]', 'h-[42rem]');
        start();
        return;
    }
    const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        start();
    }, {threshold: 0.3});
    observer.observe(container);
}

/** Plays the session into the container, step by step, the way it happened. */
async function play(session, container, run) {
    container.replaceChildren(userMessage(session.prompt));
    for (const step of session.steps) {
        await wait(STEP_PAUSE, run);
        if (step.kind === 'agent') await agentMessage(container, step.text, run);
        else await toolCall(container, step, run);
    }
    document.body.dataset.replayDone = 'true';
}

function userMessage(text) {
    const wrapper = element('div', 'flex justify-end');
    wrapper.append(element('p', 'max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-4 py-3 text-sm text-white', text));
    return wrapper;
}

async function agentMessage(container, text, run) {
    const message = element('div', 'max-w-[90%] space-y-2 text-sm leading-relaxed');
    container.append(message);
    for (const paragraph of text.split('\n\n')) {
        const line = element('p', '');
        message.append(line);
        for (const word of paragraph.split(' ')) {
            line.append(`${line.textContent ? ' ' : ''}${word}`);
            scrollToEnd(container);
            if (!REDUCED_MOTION) await wait(WORD_DELAY, run);
        }
    }
}

async function toolCall(container, step, run) {
    const card = element('div', TOOL_CARD);
    const header = element('div', 'flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700');
    if (step.mcp) header.append(element('span', 'rounded bg-brand px-1.5 py-0.5 font-mono text-[10px] text-white', 'maplibre'));
    header.append(element('span', 'font-mono text-xs font-semibold', step.name));
    header.append(element('span', 'truncate font-mono text-xs text-slate-500', step.input));
    const status = element('span', 'ml-auto font-mono text-[10px] text-slate-400', 'running');
    header.append(status);
    card.append(header);
    container.append(card);
    scrollToEnd(container);

    if (!REDUCED_MOTION) await wait(TOOL_DELAY, run);
    status.remove();
    const body = element('div', 'space-y-3 px-3 py-2');
    body.append(element('div', CODE, step.output));
    if (step.image) {
        const image = element('img', 'w-full rounded border border-slate-200 bg-white dark:border-slate-700');
        image.src = step.image;
        image.alt = step.alt;
        await image.decode().catch(() => undefined);
        body.append(image);
    }
    card.append(body);
    scrollToEnd(container);
}

function scrollToEnd(container) {
    container.scrollTop = container.scrollHeight;
}

/** Waits, holds while the replay is paused, and stops when it is restarted. */
async function wait(ms, run) {
    await new Promise(resolve => setTimeout(resolve, ms));
    while (run.paused && !run.cancelled) await new Promise(resolve => setTimeout(resolve, 100));
    if (run.cancelled) throw new Cancelled();
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Loads MapLibre GL JS when the map scrolls near, and draws what a show_map call with a walk through Copenhagen shows. */
function setUpLiveMap() {
    const container = document.getElementById('live-map');
    if (!container) return;
    const observer = new IntersectionObserver(async entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        const maplibregl = await import(MAPLIBRE_URL);
        drawWalk(maplibregl, container);
    }, {rootMargin: '300px'});
    observer.observe(container);
}

function drawWalk(maplibregl, container) {
    const walk = [[12.5903, 55.6798], [12.5856, 55.6797], [12.5822, 55.6786], [12.5776, 55.6780], [12.5747, 55.6770], [12.5708, 55.6761], [12.5694, 55.6757], [12.5683, 55.6746]];
    const tivoli = [[[12.5660, 55.6746], [12.5705, 55.6744], [12.5712, 55.6727], [12.5669, 55.6718], [12.5655, 55.6730], [12.5660, 55.6746]]];
    const map = new maplibregl.Map({
        container,
        style: BASEMAP,
        bounds: [[12.5655, 55.6718], [12.5903, 55.6798]],
        fitBoundsOptions: {padding: 40},
        cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl());
    map.once('load', () => {
        const layers = map.getStyle().layers;
        const labels = layers[layers.findLastIndex(layer => layer.type !== 'symbol') + 1]?.id;
        map.addSource('tivoli', {type: 'geojson', data: {type: 'Polygon', coordinates: tivoli}});
        map.addLayer({id: 'tivoli', type: 'fill', source: 'tivoli', paint: {'fill-color': '#e53935', 'fill-opacity': 0.25}}, labels);
        map.addSource('walk', {type: 'geojson', data: {type: 'LineString', coordinates: walk}});
        map.addLayer({id: 'walk', type: 'line', source: 'walk', paint: {'line-color': '#295daa', 'line-width': 5}, layout: {'line-cap': 'round', 'line-join': 'round'}}, labels);
    });
    new maplibregl.Marker({color: '#295daa'}).setLngLat(walk[0]).setPopup(new maplibregl.Popup({offset: 24}).setText('Nyhavn')).addTo(map);
    new maplibregl.Marker({color: '#e53935'}).setLngLat(walk.at(-1)).setPopup(new maplibregl.Popup({offset: 24}).setText('Tivoli')).addTo(map);
}

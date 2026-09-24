const MAPLIBRE_URL = 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.11.2/dist/maplibre-gl.mjs';
const BASEMAP = 'https://tiles.openfreemap.org/styles/liberty';
const STEP_DURATION = 6000;
const PICTURE_STEP_DURATION = 9000;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SELECTED_TAB = ['bg-slate-900', 'text-white', 'dark:bg-slate-800'];
const OTHER_TAB = ['text-slate-600', 'hover:text-slate-900', 'dark:text-slate-400', 'dark:hover:text-white'];
const CURRENT_STEP = ['bg-slate-100', 'dark:bg-slate-800'];
const CURRENT_NUMBER = ['border-brand', 'bg-brand', 'text-white'];
const OTHER_NUMBER = ['border-slate-300', 'text-slate-500', 'dark:border-slate-600', 'dark:text-slate-400'];

/** Where the walkthrough of the recorded session is, and whether it plays by itself. */
const walkthrough = {
    index: 0,
    playing: false,
    timer: undefined,
    steps: [],
    buttons: [],
    progress: undefined,
    playButton: undefined,
};

setUpCopyButtons();
setUpTabs();
setUpWalkthrough();
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

function setUpTabs() {
    for (const tabs of document.querySelectorAll('[data-tabs]')) {
        const buttons = [...tabs.querySelectorAll('[role=tab]')];
        const panels = [...tabs.querySelectorAll('[role=tabpanel]')];
        for (const [index, button] of buttons.entries()) button.addEventListener('click', () => selectTab(buttons, panels, index));
    }
}

function selectTab(buttons, panels, selected) {
    for (const [index, button] of buttons.entries()) {
        button.setAttribute('aria-selected', String(index === selected));
        for (const name of SELECTED_TAB) button.classList.toggle(name, index === selected);
        for (const name of OTHER_TAB) button.classList.toggle(name, index !== selected);
    }
    for (const [index, panel] of panels.entries()) panel.hidden = index !== selected;
}

/** Steps through the session by itself once it scrolls into view, and lets the reader go back and forth. */
function setUpWalkthrough() {
    const root = document.querySelector('[data-walkthrough]');
    walkthrough.steps = [...root.querySelectorAll('[data-step]')];
    walkthrough.buttons = [...root.querySelectorAll('[data-go]')];
    walkthrough.progress = root.querySelector('[data-progress]');
    walkthrough.playButton = root.querySelector('[data-play]');
    for (const button of walkthrough.buttons) button.addEventListener('click', () => goTo(Number(button.dataset.go)));
    root.querySelector('[data-previous]').addEventListener('click', () => goTo(walkthrough.index - 1));
    root.querySelector('[data-next]').addEventListener('click', () => goTo(walkthrough.index + 1));
    walkthrough.playButton.addEventListener('click', () => (walkthrough.playing ? stop() : play()));
    showStep(0);
    if (REDUCED_MOTION) return;
    const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        play();
    }, {threshold: 0.4});
    observer.observe(root);
}

/** Shows the step the reader picked, and stops playing. */
function goTo(index) {
    showStep(Math.min(Math.max(index, 0), walkthrough.steps.length - 1));
    stop();
}

function play() {
    if (isLastStep()) showStep(0);
    walkthrough.playing = true;
    walkthrough.playButton.textContent = 'Pause';
    scheduleNextStep();
}

function stop() {
    clearTimeout(walkthrough.timer);
    walkthrough.playing = false;
    walkthrough.playButton.textContent = isLastStep() ? 'Replay' : 'Play';
    walkthrough.progress.style.transition = 'none';
    walkthrough.progress.style.width = '0%';
}

function scheduleNextStep() {
    const duration = walkthrough.steps[walkthrough.index].querySelector('img') ? PICTURE_STEP_DURATION : STEP_DURATION;
    fillProgress(duration);
    walkthrough.timer = setTimeout(() => {
        if (isLastStep()) {
            stop();
            return;
        }
        showStep(walkthrough.index + 1);
        scheduleNextStep();
    }, duration);
}

/** Fills the bar above the step over the time the step stays. */
function fillProgress(duration) {
    const bar = walkthrough.progress;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    // Reading the width applies the reset, so the transition starts from zero.
    void bar.offsetWidth;
    bar.style.transition = `width ${duration}ms linear`;
    bar.style.width = '100%';
}

function isLastStep() {
    return walkthrough.index === walkthrough.steps.length - 1;
}

function showStep(index) {
    walkthrough.index = index;
    for (const [position, step] of walkthrough.steps.entries()) {
        const hidden = position !== index;
        step.classList.toggle('invisible', hidden);
        step.classList.toggle('opacity-0', hidden);
        step.inert = hidden;
    }
    for (const [position, button] of walkthrough.buttons.entries()) markStepButton(button, position === index);
}

function markStepButton(button, current) {
    button.setAttribute('aria-current', current ? 'step' : 'false');
    button.querySelector('[data-caption]').classList.toggle('hidden', !current);
    for (const name of CURRENT_STEP) button.classList.toggle(name, current);
    const number = button.querySelector('[data-number]');
    for (const name of CURRENT_NUMBER) number.classList.toggle(name, current);
    for (const name of OTHER_NUMBER) number.classList.toggle(name, !current);
}

/** Loads MapLibre GL JS when the map scrolls near, and draws what a show_map call with a walk through Copenhagen shows. */
function setUpLiveMap() {
    const container = document.getElementById('live-map');
    if (!container) return;
    const observer = new IntersectionObserver(async entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        const maplibregl = await import(/* @vite-ignore */ MAPLIBRE_URL);
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

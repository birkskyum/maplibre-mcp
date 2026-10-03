import type {Toolset} from '../../toolsets.js';
import {registerDescribeGlJsApi} from './describe-gl-js-api.js';
import {glJsRenderer, MAPLIBRE_VERSION} from './renderer.js';
import {registerShowMap} from './show-map.js';

export const glJsToolset: Toolset = {
    name: 'gl-js',
    description: 'Render styles with MapLibre GL JS, look up its API, and show the user maps in the chat',
    instructions: [
        'Look up the MapLibre GL JS API with describe_gl_js_api instead of recalling it, since it changes between versions.',
        `MapLibre GL JS ${MAPLIBRE_VERSION.split('.')[0]} ships as ES modules only, so there is no maplibre-gl.js for a script tag.`,
        `A page gets the version that render_style draws with from a module script, with \`import * as maplibregl from 'https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.mjs'\`,`,
        'and its stylesheet from maplibre-gl.css in the same folder.',
    ].join(' '),
    register(server) {
        registerDescribeGlJsApi(server);
        registerShowMap(server);
    },
    renderer: glJsRenderer,
};

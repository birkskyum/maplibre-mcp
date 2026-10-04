import type {Toolset} from '../../toolsets.js';
import {registerDescribeGlJsApi} from './describe-gl-js-api.js';
import {registerPreviewStyle} from './preview-style.js';
import {registerRenderPage} from './render-page.js';
import {glJsRenderer, MAPLIBRE_VERSION} from './renderer.js';
import {registerShowMap} from './show-map.js';

export const glJsToolset: Toolset = {
    name: 'gl-js',
    description: 'Render styles with MapLibre GL JS, look up its API, and show the user maps in the chat',
    instructions: [
        'preview_style gives the user a link to a live map of a style, so there is no viewer page to write and no web server to start.',
        'render_page draws a page of your own, with the plugins, controls and code that a style cannot hold.',
        'render_style can place the camera in space over 3D terrain, from cameraPosition and lookAt.',
        'describe_gl_js_api has the API of the installed MapLibre GL JS.',
        `MapLibre GL JS ${MAPLIBRE_VERSION.split('.')[0]} has no maplibre-gl.js for a script tag.`,
        `A page loads it in a module script with \`import * as maplibregl from 'https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.mjs'\`,`,
        'and maplibre-gl.css from the same folder.',
    ].join(' '),
    register(server) {
        registerDescribeGlJsApi(server);
        registerShowMap(server);
        registerRenderPage(server);
        registerPreviewStyle(server);
    },
    renderer: glJsRenderer,
};

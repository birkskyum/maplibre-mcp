import type {Toolset} from '../../toolsets.js';
import {registerDescribeGlJsApi} from './describe-gl-js-api.js';
import {glJsRenderer} from './renderer.js';
import {registerShowMap} from './show-map.js';

export const glJsToolset: Toolset = {
    name: 'gl-js',
    description: 'Render styles with MapLibre GL JS, look up its API, and show the user maps in the chat',
    register(server) {
        registerDescribeGlJsApi(server);
        registerShowMap(server);
    },
    renderer: glJsRenderer,
};

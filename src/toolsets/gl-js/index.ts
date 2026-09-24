import type {Toolset} from '../../toolsets.js';
import {glJsRenderer} from './renderer.js';
import {registerShowMap} from './show-map.js';

export const glJsToolset: Toolset = {
    name: 'gl-js',
    description: 'Render styles with MapLibre GL JS, and show the user maps in the chat',
    register: registerShowMap,
    renderer: glJsRenderer,
};

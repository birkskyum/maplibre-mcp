import type {Toolset} from '../../toolsets.js';
import {registerDebugLayers} from './debug-layers.js';
import {registerDescribeSources} from './describe-sources.js';
import {registerDescribeStyleSpec} from './describe-style-spec.js';
import {registerInspectTile} from './inspect-tile.js';
import {registerValidateStyle} from './validate-style.js';

export const styleToolset: Toolset = {
    name: 'style',
    description: 'Validate styles, look up the style spec, check sources, inspect tiles and debug layers',
    instructions: [
        'inspect_tile shows the source layers, fields and values that real tiles hold.',
        'describe_style_spec has every layer type and property of the current style spec, and lists the layer types when asked for layers.',
        'debug_layers says why a layer draws nothing at a place.',
    ].join(' '),
    renderFailureHint: 'describe_sources gives the sources of any style, also of a basemap\'s style URL, with the TileJSON URL and source layers to build on.',
    register(server) {
        registerValidateStyle(server);
        registerDescribeStyleSpec(server);
        registerDescribeSources(server);
        registerInspectTile(server);
        registerDebugLayers(server);
    },
};

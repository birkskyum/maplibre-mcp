import type {Toolset} from '../../toolsets.js';
import {registerDebugLayers} from './debug-layers.js';
import {registerDescribeSources} from './describe-sources.js';
import {registerDescribeStyleSpec} from './describe-style-spec.js';
import {registerFormatStyle, registerMigrateStyle} from './format-style.js';
import {registerInspectTile} from './inspect-tile.js';
import {registerValidateStyle} from './validate-style.js';

export const styleToolset: Toolset = {
    name: 'style',
    description: 'Validate, format and migrate styles, look up the style spec, check sources, inspect tiles and debug layers',
    instructions: [
        'Before you write a style, read what its tiles hold with inspect_tile, so that the layers and filters match the data.',
        'Look up the layer types and properties you use with describe_style_spec instead of recalling them.',
        'Asking it for layers lists every layer type, including ones that are newer than what you may remember.',
        'Check a style with validate_style each time you change it. When a layer draws nothing, debug_layers says why.',
    ].join(' '),
    register(server) {
        registerValidateStyle(server);
        registerDescribeStyleSpec(server);
        registerDescribeSources(server);
        registerInspectTile(server);
        registerDebugLayers(server);
        registerFormatStyle(server);
        registerMigrateStyle(server);
    },
};

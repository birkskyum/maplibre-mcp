import type {Toolset} from '../../toolsets.js';
import {registerDescribeSources} from './describe-sources.js';
import {registerDescribeStyleSpec} from './describe-style-spec.js';
import {registerFormatStyle, registerMigrateStyle} from './format-style.js';
import {registerInspectTile} from './inspect-tile.js';
import {registerValidateStyle} from './validate-style.js';

export const styleToolset: Toolset = {
    name: 'style',
    description: 'Validate, format and migrate styles, look up the style spec, check sources and inspect tiles',
    register(server) {
        registerValidateStyle(server);
        registerDescribeStyleSpec(server);
        registerDescribeSources(server);
        registerInspectTile(server);
        registerFormatStyle(server);
        registerMigrateStyle(server);
    },
};

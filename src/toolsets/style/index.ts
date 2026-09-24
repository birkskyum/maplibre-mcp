import type {Toolset} from '../../toolsets.js';
import {registerDescribeSources} from './describe-sources.js';
import {registerDescribeStyleSpec} from './describe-style-spec.js';
import {registerFormatStyle, registerMigrateStyle} from './format-style.js';
import {registerValidateStyle} from './validate-style.js';

export const styleToolset: Toolset = {
    name: 'style',
    description: 'Validate, format and migrate styles, look up the style spec, and check sources',
    register(server) {
        registerValidateStyle(server);
        registerDescribeStyleSpec(server);
        registerDescribeSources(server);
        registerFormatStyle(server);
        registerMigrateStyle(server);
    },
};

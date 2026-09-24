import {build} from 'esbuild';

await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    banner: {js: '#!/usr/bin/env node'},
    outfile: 'dist/index.js',
});

await build({
    entryPoints: ['src/toolsets/gl-js/show-map-view.ts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    minify: true,
    outfile: 'dist/show-map-view.js',
});

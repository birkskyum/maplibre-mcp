import {build, type Plugin} from 'esbuild';
import {fileURLToPath} from 'node:url';

/**
 * `@maplibre/mlt` ships ES modules whose imports have no file extensions, which Node cannot load, so it is bundled.
 * The package it imports, `@mapbox/point-geometry`, stays external and is a dependency of this package for that reason.
 */
const bundleMlt: Plugin = {
    name: 'bundle-mlt',
    setup(context) {
        context.onResolve({filter: /^@maplibre\/mlt$/}, () => ({path: fileURLToPath(import.meta.resolve('@maplibre/mlt'))}));
    },
};

await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    plugins: [bundleMlt],
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

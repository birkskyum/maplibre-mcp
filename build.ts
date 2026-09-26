import {build, type Plugin} from 'esbuild';
import {fileURLToPath} from 'node:url';

/**
 * Bundles packages that would not work, or would cost too much, as dependencies. `@maplibre/mlt` ships ES modules
 * whose imports have no file extensions, which Node cannot load. The package it imports, `@mapbox/point-geometry`,
 * stays external and is a dependency of this package for that reason. `@babel/parser` depends on `@babel/types` only
 * for its type definitions, which would add 3 MB to every install.
 */
const bundlePackages: Plugin = {
    name: 'bundle-packages',
    setup(context) {
        context.onResolve({filter: /^(@maplibre\/mlt|@babel\/parser)$/}, ({path}) => ({path: fileURLToPath(import.meta.resolve(path))}));
    },
};

await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    plugins: [bundlePackages],
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

import {encodeTile} from '@maplibre/mlt';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {PNG} from 'pngjs';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {serveJson} from './connect.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const BLUE_STYLE = {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#3366cc'}}]};
const RED_STYLE = {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#cc3333'}}]};

describe('command line', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'maplibre-mcp-'));
        await writeFile(path.join(dir, 'blue.json'), JSON.stringify(BLUE_STYLE));
        await writeFile(path.join(dir, 'red.json'), JSON.stringify(RED_STYLE));
    });

    afterEach(async () => {
        await rm(dir, {recursive: true});
    });

    test('renders a style file to a PNG', async () => {
        const {stdout} = await run(process.execPath, [CLI, 'render', 'blue.json', '--width', '120', '--height', '80', '--out', 'blue.png'], {cwd: dir});
        const png = PNG.sync.read(await readFile(path.join(dir, 'blue.png')));
        expect(stdout).toContain('Wrote blue.png.');
        expect([png.width, png.height]).toEqual([120, 80]);
    });

    test('compares a style before and after a change', async () => {
        const {stdout} = await run(process.execPath, [CLI, 'compare', 'blue.json', 'red.json', '--width', '64', '--height', '64'], {cwd: dir});
        expect(stdout).toContain('100% of the pixels differ (4096 of 4096).');
    });

    test('inspects the MLT tile at a place', async () => {
        const places = encodeTile([{name: 'places', extent: 4096, features: [{geometry: {type: 'Point', coordinates: [100, 100]}, properties: {kind: 'city'}}]}]);
        const {origin, server} = await serveJson({'/0/0/0.mlt': places});
        const {stdout} = await run(process.execPath, [CLI, 'inspect-tile', `${origin}/{z}/{x}/{y}.mlt`, '--center', '0,0', '--zoom', '0'], {cwd: dir});
        server.close();
        expect(stdout).toContain('places: 1 feature (1 Point)\n  kind: "city" (1)');
    });
});

import {parse} from '@babel/parser';
import {readFile} from 'node:fs/promises';
import {describe, expect, test} from 'vitest';
import pkg from '../package.json' with {type: 'json'};

describe('package', () => {
    test('imports only the packages it declares as dependencies', async () => {
        const bundle = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
        const imported = parse(bundle, {sourceType: 'module'}).program.body
            .flatMap(node => node.type === 'ImportDeclaration' ? [node.source.value] : [])
            .filter(specifier => !specifier.startsWith('node:'))
            .map(specifier => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/'));
        expect([...new Set(imported)].filter(name => !Object.hasOwn(pkg.dependencies, name))).toEqual([]);
    });
});

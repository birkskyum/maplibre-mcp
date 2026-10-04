import type {McpServer} from '@modelcontextprotocol/server';
import type {Renderer} from './render-style.js';
import {ecosystemToolset} from './toolsets/ecosystem/index.js';
import {glJsToolset} from './toolsets/gl-js/index.js';
import {martinToolset} from './toolsets/martin/index.js';
import {nativeToolset} from './toolsets/native/index.js';
import {styleToolset} from './toolsets/style/index.js';

/** A group of tools for one MapLibre project, enabled with `--toolsets`. */
export type Toolset = {
    name: string;
    description: string;
    register?: (server: McpServer) => void;
    /** How to work with the toolset's tools, as part of the instructions the server gives its client. */
    instructions?: string;
    /** What the toolset can do about a style that did not load, as a line for a render that failed. */
    renderFailureHint?: string;
    /** A renderer that the shared `render_style` tool offers. */
    renderer?: Renderer;
};

export const TOOLSETS: Toolset[] = [styleToolset, glJsToolset, nativeToolset, martinToolset, ecosystemToolset];

const DEFAULT_TOOLSETS = ['style', 'gl-js', 'ecosystem'];

/** Returns the toolsets in a comma separated list of names, or the default ones when the list is empty. */
export function selectToolsets(list: string | undefined): Toolset[] {
    const names = list ? list.split(',').map(name => name.trim()) : DEFAULT_TOOLSETS;
    if (names.includes('all')) return TOOLSETS;
    return names.map(findToolset);
}

function findToolset(name: string): Toolset {
    const toolset = TOOLSETS.find(candidate => candidate.name === name);
    if (!toolset) {
        throw new Error(`Unknown toolset "${name}". The toolsets are: ${TOOLSETS.map(t => t.name).join(', ')}, all.`);
    }
    return toolset;
}

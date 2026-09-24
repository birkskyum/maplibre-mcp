import type {StyleSpecification} from '@maplibre/maplibre-gl-style-spec';
import type {CallToolResult} from '@modelcontextprotocol/server';
import {readFile, writeFile} from 'node:fs/promises';
import {z} from 'zod';

/** Input fields of the tools that take a style. Exactly one of them has to be set. */
export const STYLE_INPUT = {
    style: z.record(z.string(), z.unknown()).optional().describe('The style as a JSON object.'),
    url: z.url().optional().describe('URL of a style JSON document.'),
    path: z.string().optional().describe('Path to a style JSON file, relative to the directory the server runs in.'),
};

export type StyleInput = {
    style?: Record<string, unknown>;
    url?: string;
    path?: string;
};

/** Returns the style given as an object, a URL or a file path. */
export async function loadStyle(input: StyleInput): Promise<StyleSpecification> {
    const given = [input.style, input.url, input.path].filter(value => value !== undefined);
    if (given.length !== 1) throw new Error('Pass exactly one of style, url and path.');
    if (input.url !== undefined) return fetchJson(input.url);
    if (input.path !== undefined) return JSON.parse(await readFile(input.path, 'utf8'));
    return input.style as StyleSpecification;
}

/**
 * Returns a rewritten style to the caller. A style that came from a file is written back to that file,
 * so a large style does not have to travel through the conversation.
 */
export async function returnStyle(input: StyleInput, json: string, action: string): Promise<CallToolResult> {
    if (input.path === undefined) return {content: [{type: 'text', text: json}]};
    await writeFile(input.path, json);
    return {content: [{type: 'text', text: `${action} ${input.path}.`}]};
}

/** Fetches a JSON document. MapLibre has no `mapbox://` scheme, so those URLs fail with a hint instead. */
export async function fetchJson<T>(url: string): Promise<T> {
    if (url.startsWith('mapbox://')) {
        throw new Error(`MapLibre does not resolve mapbox:// URLs (${url}). Use the https URL of the resource instead.`);
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetching ${url} failed with HTTP ${response.status}.`);
    return response.json();
}

import type {APIRoute} from 'astro';
import {docsPath, getDocs, sitePath} from '../docs';

/** An index of the docs for language models, as proposed at https://llmstxt.org. */
export const GET: APIRoute = async ({site}) => {
    const pages = await getDocs();
    const lines = [
        '# maplibre-mcp',
        '',
        '> An MCP server that lets AI agents check, render and show MapLibre styles. It runs on the user\'s machine and needs no API key.',
        '',
        'Clients start it with `npx -y maplibre-mcp` as a stdio server. In Claude Code: `claude mcp add maplibre -- npx -y maplibre-mcp`.',
        '',
        '## Docs',
        '',
        ...pages.map(page => `- [${page.data.title}](${new URL(docsPath(page), site)}): ${page.data.description}`),
        '',
        '## Optional',
        '',
        `- [All docs in one file](${new URL(sitePath('llms-full.txt'), site)})`,
        '- [Source code](https://github.com/birkskyum/maplibre-mcp)',
    ];
    return new Response(`${lines.join('\n')}\n`);
};

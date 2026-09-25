import {satteri} from '@astrojs/markdown-satteri';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'astro/config';
import starlightLlmsTxt from 'starlight-llms-txt';
import {INSTALL_COMMANDS, SUMMARY} from './src/project.ts';

const SITE = 'https://birkskyum.github.io';
const BASE = '/maplibre-mcp';

export default defineConfig({
    site: SITE,
    base: BASE,
    markdown: {processor: satteri({features: {smartPunctuation: false}})},
    integrations: [
        starlight({
            title: 'maplibre-mcp',
            description: SUMMARY,
            favicon: '/favicon.svg',
            social: [{icon: 'github', label: 'GitHub', href: 'https://github.com/birkskyum/maplibre-mcp'}],
            customCss: ['./src/styles/starlight.css'],
            head: [{tag: 'meta', attrs: {property: 'og:image', content: `${SITE}${BASE}/images/social.png`}}],
            expressiveCode: {defaultProps: {wrap: true}},
            sidebar: [
                {label: 'Guide', items: ['getting-started', 'examples', 'command-line', 'rendering', 'remote-server', 'troubleshooting']},
                {label: 'Reference', items: ['tools', 'changelog']},
            ],
            plugins: [
                starlightLlmsTxt({
                    details: [
                        'Add it to an AI client with one of these commands:',
                        '',
                        ...INSTALL_COMMANDS.map(install => `- ${install.client}: \`${install.command}\``),
                        '- Claude Desktop, Cursor, Windsurf and most other clients: `{"mcpServers": {"maplibre": {"command": "npx", "args": ["-y", "maplibre-mcp"]}}}`',
                        '',
                        'Agents with a shell can also run the rendering and data tools as commands, without MCP, like `npx -y maplibre-mcp render style.json --center 12.57,55.68 --zoom 12`, which writes map.png.',
                    ].join('\n'),
                    optionalLinks: [{label: 'Source code', url: 'https://github.com/birkskyum/maplibre-mcp'}],
                    promote: ['getting-started', 'examples'],
                    rawContent: true,
                }),
            ],
        }),
    ],
    vite: {plugins: [tailwindcss()]},
});

import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'astro/config';

export default defineConfig({
    site: 'https://birkskyum.github.io',
    base: '/maplibre-mcp',
    markdown: {smartypants: false},
    vite: {plugins: [tailwindcss()]},
});

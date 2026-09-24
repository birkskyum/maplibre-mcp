import type {APIRoute} from 'astro';
import {getDocs} from '../docs';

/** Every docs page as Markdown in one file, for language models. */
export const GET: APIRoute = async () => {
    const pages = await getDocs();
    const text = pages.map(page => `# ${page.data.title}\n\n${page.body?.trim()}`).join('\n\n');
    return new Response(`${text}\n`);
};

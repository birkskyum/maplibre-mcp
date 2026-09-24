import {glob} from 'astro/loaders';
import {z} from 'astro/zod';
import {defineCollection} from 'astro:content';

const docs = defineCollection({
    loader: glob({pattern: '*.md', base: './src/content/docs'}),
    schema: z.object({
        title: z.string(),
        description: z.string(),
        /** The part of the top navigation the page belongs to. */
        section: z.enum(['guide', 'examples', 'tools']),
        /** The position of the page in the sidebar. */
        order: z.number(),
    }),
});

export const collections = {docs};

import {type CollectionEntry, getCollection} from 'astro:content';

export type DocsPage = CollectionEntry<'docs'>;

export type Section = DocsPage['data']['section'];

/** An entry of the top navigation, which leads to the first page of a section. */
export type NavigationItem = {
    section: Section;
    title: string;
    href: string;
};

/** The sections of the docs, in the order of the top navigation. */
const SECTION_TITLES: Record<Section, string> = {
    guide: 'Guide',
    examples: 'Examples',
    tools: 'Tools',
};

/** Returns the docs pages in the order of the sidebar. */
export async function getDocs(): Promise<DocsPage[]> {
    return (await getCollection('docs')).sort((a, b) => a.data.order - b.data.order);
}

/** Returns the entries of the top navigation. */
export async function getNavigation(): Promise<NavigationItem[]> {
    const pages = await getDocs();
    return Object.entries(SECTION_TITLES).flatMap(([section, title]) => {
        const first = pages.find(page => page.data.section === section);
        return first ? [{section: first.data.section, title, href: docsPath(first)}] : [];
    });
}

export function docsPath(page: DocsPage): string {
    return sitePath(`${page.id}/`);
}

/** Returns the path of a page or file under the base the site is served from. */
export function sitePath(path: string): string {
    return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path}`;
}

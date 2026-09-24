/** Returns the path of a page or file under the base the site is served from. */
export function sitePath(path: string): string {
    return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path}`;
}

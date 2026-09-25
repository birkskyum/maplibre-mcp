import {writeFile} from 'node:fs/promises';

/** The fields of a GitHub release that the changelog uses. */
type Release = {
    tag_name: string;
    body: string | null;
    html_url: string;
    published_at: string | null;
    draft: boolean;
    prerelease: boolean;
};

const REPOSITORY = 'birkskyum/maplibre-mcp';
const PAGE = new URL('src/content/docs/changelog.md', import.meta.url);

await writeFile(PAGE, page(await listReleases()));

/** Fetches the published releases, newest first. A `GITHUB_TOKEN` raises GitHub's rate limit, which CI needs. */
async function listReleases(): Promise<Release[]> {
    const headers: Record<string, string> = {accept: 'application/vnd.github+json'};
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`, {headers});
    if (!response.ok) throw new Error(`Fetching the releases of ${REPOSITORY} failed with HTTP ${response.status}.`);
    const releases: Release[] = await response.json();
    return releases.filter(release => !release.draft && !release.prerelease);
}

function page(releases: Release[]): string {
    const lines = [
        '---',
        'title: Changelog',
        'description: What changed in each release of maplibre-mcp.',
        '---',
        '',
        `The release notes of each version, also on [GitHub](https://github.com/${REPOSITORY}/releases), which has a [feed](https://github.com/${REPOSITORY}/releases.atom) for following new releases.`,
        ...releases.flatMap(releaseLines),
    ];
    return `${lines.join('\n')}\n`;
}

function releaseLines({tag_name: tag, body, html_url: url, published_at: published}: Release): string[] {
    const date = published?.slice(0, 10) ?? 'Unreleased';
    return ['', `## ${tag.replace(/^v/, '')}`, '', `${date} · [On GitHub](${url})`, '', ...demoteHeadings(body ?? '')];
}

/** Moves the headings of the release notes one level down, below the version heading, and leaves code blocks alone. */
function demoteHeadings(markdown: string): string[] {
    let inCode = false;
    return markdown.replaceAll('\r\n', '\n').split('\n').map(line => {
        if (line.startsWith('```')) inCode = !inCode;
        return !inCode && /^#{1,5} /.test(line) ? `#${line}` : line;
    });
}

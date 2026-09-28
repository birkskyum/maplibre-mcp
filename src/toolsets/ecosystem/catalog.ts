import {fetchJson} from '../../style-input.js';

/** The catalog of Make with MapLibre, as served at https://makewithmaplibre.com/catalog.json. */
export type Catalog = {
    schemaVersion: number;
    site: string;
    generatedAt: string;
    libraries: Library[];
    basemaps: Basemap[];
    services: Service[];
    products: Product[];
    makers: Maker[];
};

export type LibraryKind = 'sdk' | 'plugin' | 'navigation' | 'geocoding' | 'styling' | 'tile-infrastructure';

export type Library = {
    slug: string;
    name: string;
    kind: LibraryKind;
    tagline?: string;
    description: string;
    link: string;
    url: string;
    repository?: string;
    npm?: string;
    documentation?: string;
    license?: string;
    platforms: string[];
    languages: string[];
    frameworks: string[];
    renderers: string[];
    maker?: string;
    weight?: number;
};

export type Basemap = {
    slug: string;
    name: string;
    provider: string;
    description: string;
    styleUrl?: string;
    tileUrl?: string | string[];
    free: boolean;
    url: string;
};

export type ServiceKind = 'routing-api' | 'geocoding-api' | 'style-editor' | 'tile-host';

export type Service = {
    slug: string;
    name: string;
    kind: ServiceKind;
    link: string;
    description?: string;
    note?: string;
    maker?: string;
    sponsored?: boolean;
};

export type Product = {
    slug: string;
    name: string;
    tagline?: string;
    description: string;
    link: string;
    url: string;
    categories: string[];
    renderers: string[];
    platforms: string[];
    frameworks: string[];
    uses: Record<'sdks' | 'plugins' | 'routing' | 'geocoding' | 'tileInfrastructure', string[]>;
    maker?: string;
    weight?: number;
};

export type Maker = {
    slug: string;
    name: string;
    link: string;
    description?: string;
    consultancy: boolean;
    url: string;
};

/** The catalog schema version this server reads. The site bumps it when it renames or removes a field. */
const SCHEMA_VERSION = 1;
const DEFAULT_URL = 'https://makewithmaplibre.com/catalog.json';
const MAX_AGE = 24 * 60 * 60 * 1000;

const cache = new Map<string, {catalog: Promise<Catalog>; fetched: number}>();

/** Returns the catalog, fetched at most once a day. MAPLIBRE_MCP_CATALOG_URL points to another copy of it. */
export function loadCatalog(): Promise<Catalog> {
    const url = process.env.MAPLIBRE_MCP_CATALOG_URL || DEFAULT_URL;
    const cached = cache.get(url);
    if (cached && Date.now() - cached.fetched < MAX_AGE) return cached.catalog;
    const catalog = fetchCatalog(url);
    cache.set(url, {catalog, fetched: Date.now()});
    catalog.catch(() => cache.delete(url));
    return catalog;
}

async function fetchCatalog(url: string): Promise<Catalog> {
    let catalog: Catalog;
    try {
        catalog = await fetchJson<Catalog>(url);
    } catch (error) {
        const reason = (error instanceof Error ? error.message : String(error)).replace(/\.?$/, '.');
        throw new Error(`Could not load the Make with MapLibre catalog from ${url}: ${reason} The ecosystem tools need to reach it over the network.`);
    }
    if (catalog.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`The catalog at ${url} has schema version ${catalog.schemaVersion}, and this maplibre-mcp reads version ${SCHEMA_VERSION}. Update maplibre-mcp.`);
    }
    return catalog;
}

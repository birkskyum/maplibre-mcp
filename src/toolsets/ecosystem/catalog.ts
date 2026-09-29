import {fetchJson} from '../../style-input.js';

/** The catalog of Make with MapLibre, as served at https://makewithmaplibre.com/catalog.json. */
export type Catalog = {
    schemaVersion: number;
    site: string;
    generatedAt: string;
    copyright?: string;
    copyrightHolder?: string;
    /** An SPDX identifier, like CC-BY-4.0. */
    license?: string;
    licenseUrl?: string;
    /** The credit the license asks for when the data is passed on. */
    attribution?: string;
    /** Where that credit links to. */
    attributionUrl?: string;
    productCategories: ProductCategory[];
    libraries: Library[];
    basemaps: Basemap[];
    services: Service[];
    products: Product[];
    makers: Maker[];
};

export type LibraryKind = 'sdk' | 'plugin' | 'routing' | 'geocoding' | 'styling' | 'tiling';

export type ProductCategory = {
    slug: string;
    name: string;
    description: string;
    url: string;
};

export type Library = {
    slug: string;
    name: string;
    kind: LibraryKind;
    /** The section of its page on Make with MapLibre, for SDKs and plugins, like framework or drawing. */
    group?: string;
    tagline?: string;
    description: string;
    link: string;
    url: string;
    /** A live demo on Make with MapLibre. */
    demo?: string;
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
    type?: 'style' | 'raster' | 'terrain';
    provider: string;
    description: string;
    styleUrl?: string;
    tileUrl?: string | string[];
    /** The pixel size of the tiles at tileUrl, 256 when absent. */
    tileSize?: 256 | 512;
    /** The encoding of elevation tiles. */
    encoding?: 'terrarium' | 'mapbox';
    /** The credit the map has to show, as HTML. Styles usually carry their own. */
    attribution?: string;
    /** The npm package of a logo control that the provider's terms require on every map. */
    logoControl?: string;
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
    /** Slugs of productCategories. */
    categories: string[];
    renderers: string[];
    platforms: string[];
    frameworks: string[];
    /** Slugs of the libraries, basemaps and services it is built with. */
    uses: string[];
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

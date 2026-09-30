---
title: Libraries and basemaps
description: How search_ecosystem and find_basemaps find SDKs, plugins, services and basemaps in Make with MapLibre, and what they return.
---

The `ecosystem` toolset answers "what should I use?" from [Make with MapLibre](https://makewithmaplibre.com), a curated directory of what works with MapLibre: SDKs and framework bindings, GL JS plugins, routing and geocoding engines, styling and tiling tools, hosted APIs, basemaps, the products made with MapLibre, and consultancies. It is on by default, and has two tools:

- `search_ecosystem` finds libraries, hosted services, products and consultancies.
- `find_basemaps` lists basemaps, with what a map needs to use each one.

[Examples](/maplibre-mcp/examples/#pick-libraries-and-map-data-for-an-app) shows a whole session with them.

## Where the data comes from

Both tools read the directory's catalog, https://makewithmaplibre.com/catalog.json. The server fetches it the first time a tool needs it and keeps it for a day, so the tools need network access. `MAPLIBRE_MCP_CATALOG_URL` points them to another copy of it.

The catalog has a schema version. This server reads version 1, and asks you to update maplibre-mcp if the directory moves to a newer one.

## Searching

`search_ecosystem` takes words, a kind and a platform:

| Parameter | What it does |
| --- | --- |
| `query` | Words that every result has to contain, in its name, description, platforms, frameworks, languages or maker. Leave it out to list the most prominent entries. |
| `kind` | `sdk`, `plugin`, `routing`, `geocoding`, `styling`, `tiling`, `ai`, `service`, `product` or `consultant`. `ai` is MCP servers and agent skills for MapLibre. `routing`, `geocoding`, `styling` and `tiling` include the hosted services of that kind. |
| `platform` | `Web`, `iOS`, `Android`, `Desktop` or `Server`. Hosted services and consultancies have no platform, and are kept. |
| `limit` | The most results to return, 10 by default. |

Results whose name has the words come first, then the rest in the order of prominence the directory gives them. Each result has its kind and the section of the directory it is listed in, what it runs on, its links, its live demo when it has one, and its page on Make with MapLibre:

```text
maplibre-gl-terradraw (plugin, drawing): Drawing and measuring toolbar on Terra Draw
  A MapLibre GL JS control that puts Terra Draw behind a ready-made toolbar: points, lines, polygons, circles, freehand and text, with select, undo, GeoJSON download, and a measuring variant.
  Web · JavaScript, TypeScript · MapLibre GL JS · MIT
  https://github.com/watergis/maplibre-gl-terradraw, docs https://terradraw.water-gis.com/, npm https://www.npmjs.com/package/@watergis/maplibre-gl-terradraw
  Live demo: https://makewithmaplibre.com/plugins/maplibre-gl-terradraw/#live-demo
  More: https://makewithmaplibre.com/plugins/maplibre-gl-terradraw/
```

A product also says what it is built with, which answers questions like "which apps use Valhalla?". Products a map maker can build on (maps APIs, GIS tools, data sources, self-hostable apps) also list what they offer, and searches match those points, so "geocoding" finds the platforms with a geocoding API. A hosted service that is a sponsored listing on Make with MapLibre says so, for the agent to pass on.

## Basemaps

`find_basemaps` lists ready-made styles, raster tiles and elevation tiles, the free ones first. `query` keeps those with the words in their name, provider or description, and `free` keeps those that need no API key (`true`) or those that do (`false`).

Each basemap says how to add it to a map, and what its provider requires the map to show:

```text
Mapterhorn Terrain by Mapterhorn, free, no API key: Open elevation tiles in Terrarium format: 30 m worldwide and 1 m or finer where countries publish lidar data. Free with no API key; credit Mapterhorn and its sources. Use for hillshading and 3D terrain in MapLibre.
  Tiles, to add as a raster-dem source with tileSize 512: https://tiles.mapterhorn.com/{z}/{x}/{y}.webp
  Elevation encoding: terrarium
  Attribution the map has to show: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>
  More: https://makewithmaplibre.com/basemaps/styles/mapterhorn/
```

- A style is loaded by its URL. The style URLs of basemaps that need an API key fail until the provider's key is added to them.
- Tiles are added as a `raster` source, or a `raster-dem` source for elevation, with the `tileSize` given. MapLibre assumes 512 pixel tiles, so a source of 256 pixel tiles has to say so.
- Elevation tiles give their encoding, `terrarium` or `mapbox`, which the `raster-dem` source needs. With the wrong one, terrain comes out as noise.
- The attribution is the credit the map has to show. Styles usually carry their own.
- Some providers' terms require their logo on the map. The result then names the npm package of the control that adds it, like `@maptoolkit/maplibre-logo-control` for Maptoolkit's styles.

## Credit

The data of Make with MapLibre is © Birk Skyum, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Both tools end with its credit, and ask the agent to keep it, with a link, when it passes the results on:

```text
Source: Make with MapLibre (makewithmaplibre.com), by Birk Skyum, CC BY 4.0, generated 2026-09-29. Credit it and link to https://makewithmaplibre.com/ when you pass this on.
```

## Missing or wrong entries

Anyone can suggest a new entry or a correction on [Make with MapLibre](https://makewithmaplibre.com/about/#get-listed). Changes reach the tools within a day of being published, when the server's copy of the catalog expires.

## Leaving it out

To run maplibre-mcp without network access to makewithmaplibre.com, list the toolsets you want without `ecosystem`:

```sh
npx -y maplibre-mcp --toolsets style,gl-js
```

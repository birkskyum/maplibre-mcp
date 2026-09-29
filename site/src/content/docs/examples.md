---
title: Examples
description: Real tool calls from agents using maplibre-mcp, and what they returned.
---

The agent chooses which tools to call and with what. Each example shows a real call and the result it returned.

## Recolor a style and check the change

This is the Claude Code session that the [home page](/maplibre-mcp/) walks through. The prompt was:

> style.json is a copy of OpenFreeMap's Liberty style, https://tiles.openfreemap.org/styles/liberty. Make the motorways red in style.json. Then check that the style is still valid, and show me a before and after around Copenhagen.

The agent searched style.json for the motorway layers, read their paint properties, and ran `validate_style` on the file before changing it. It then made three edits to the colors, ran `validate_style` again, and compared the original style with the file:

```json
{
  "before": {"url": "https://tiles.openfreemap.org/styles/liberty"},
  "after": {"path": "style.json"},
  "center": [12.5, 55.68],
  "zoom": 10,
  "width": 600,
  "height": 450
}
```

`compare_styles` returned this image and text:

![Greater Copenhagen at zoom 10, before and after, with the motorways turned from orange to red, and a third panel where only the motorways are marked as different](/maplibre-mcp/images/compare-z10.webp)

```text
Left to right: Before, After, and the differences in red.
1.48% of the pixels differ (3986 of 270000).
Camera: center [12.5, 55.68], zoom 10, bearing 0, pitch 0.
Before: Rendered with MapLibre GL JS 6.11.2.
After: Rendered with MapLibre GL JS 6.11.2.
```

It checked again closer in, at zoom 13 over the E20 interchange on Amager:

![The E20 interchange on Amager at zoom 13, before and after, with the motorway and its ramps turned red](/maplibre-mcp/images/compare-z13.webp)

Then it answered:

> Motorways in style.json are now red, the style still validates cleanly, and the before/after comparisons around Copenhagen show only the motorways changing.

## Catch layers that don't match the data

A layer that uses a source layer or field the tiles don't have draws nothing, and the map raises no error. This style has two such layers. OpenMapTiles calls the source layer `building`, not `buildings`, and has no `kind` field in `transportation`:

```json
{
  "id": "buildings",
  "type": "fill",
  "source": "openmaptiles",
  "source-layer": "buildings",
  "paint": {"fill-color": "#d6d0c4"}
},
{
  "id": "motorways",
  "type": "line",
  "source": "openmaptiles",
  "source-layer": "transportation",
  "filter": ["==", ["get", "kind"], "highway"],
  "paint": {"line-color": "#e53935", "line-width": 3}
}
```

`describe_sources` reads the TileJSON of each source and checks every layer against it:

```text
Sources:
openmaptiles (vector), used by 3 layers
  TileJSON: https://tiles.openfreemap.org/planet
  Zoom 0 to 14.
  Source layers and their fields:
    aerodrome_label: class, ele, ele_ft, iata, icao, name, name:* (79 fields), name_de, name_en, name_int
    aeroway: class, ref
    boundary: adm0_l, adm0_r, admin_level, claimed_by, class, disputed, disputed_name, maritime, name, name:* (68 fields), name_de, name_en, name_int
    building: colour, hide_3d, render_height, render_min_height
    housenumber: housenumber
    landcover: class, subclass
    landuse: class
    mountain_peak: class, customary_ft, ele, ele_ft, name, name:* (80 fields), name_de, name_en, name_int, rank
    park: class, name, name:* (80 fields), name_de, name_en, name_int, rank
    place: capital, class, iso_a2, name, name:* (80 fields), name_de, name_en, name_int, rank
    poi: agg_stop, class, indoor, layer, level, name, name:* (80 fields), name_de, name_en, name_int, rank, subclass
    transportation: access, bicycle, brunnel, class, expressway, foot, horse, indoor, layer, level, mtb_scale, network, official, oneway, ramp, service, subclass, surface, toll
    transportation_name: class, indoor, layer, level, name, name:* (80 fields), name_de, name_en, name_int, network, ref, ref_length, route_*_colour (16 fields), route_*_name (21 fields), route_*_network (21 fields), route_*_ref (18 fields), subclass
    water: brunnel, class, id, intermittent
    water_name: class, intermittent, name, name:* (80 fields), name_de, name_en, name_int
    waterway: brunnel, class, intermittent, name, name:* (80 fields), name_de, name_en, name_int

Problems:
  Layer "buildings" uses the source layer "buildings", which "openmaptiles" does not have. It has: aerodrome_label, aeroway, boundary, building, housenumber, landcover, landuse, mountain_peak, park, place, poi, transportation, transportation_name, water, water_name, waterway.
  Layer "motorways" reads the field "kind", which "openmaptiles" does not list for "transportation".
```

To fix the filter, the agent needs to know what the roads are called. `inspect_tile` reads the tile over Copenhagen at zoom 10 and counts the values of each field:

```text
Tile 10/547/320 of https://tiles.openfreemap.org/planet, at [12.57, 55.68], MVT, 102.5 kB.

transportation: 67 features (67 LineString)
  subclass (in 5 of 67): "rail" (5)
  brunnel (in 8 of 67): "tunnel" (6), "bridge" (2)
  class: "primary" (28), "secondary" (19), "motorway" (10), "rail" (5), "trunk_construction" (2), "trunk" (2), "ferry" (1)
  ramp (in 21 of 67): 1 (21)
```

So the filter becomes `["==", ["get", "class"], "motorway"]`.

`debug_layers` answers the same question from the other end, for a place. It reads the tiles there and says for each layer whether it draws, and if not, why:

```text
At [12.57, 55.68], zoom 14: 2 draw nothing.
Read source "openmaptiles": tile 14/8764/5127, MVT.

buildings (fill): draws nothing, since the tile has no source layer "buildings". It has: boundary, building, housenumber, landcover, landuse, park, place, poi, transportation, transportation_name, water, water_name, waterway.
motorways (line): draws nothing, since its filter matches none of the 568 features in source layer "transportation". No feature has the field "kind".
```

It also asks the glyph server for the fonts of each label layer. GL JS draws text in a font the server lacks with local fonts, and MapLibre Native leaves it out:

```text
places (symbol): draws 16 of the 16 features in source layer "place". Its text is drawn with local fonts, since the glyph server lacks the font stack "Open Sans Bold".
```

## Look up the style specification

Mapbox GL JS has properties that MapLibre doesn't, and models mix the two up. `describe_style_spec` answers from the MapLibre Style Specification, so it catches a property from Mapbox's lighting, and suggests the closest names for a typo:

```text
"line-emissive-strength" is not in the MapLibre Style Specification.
```

```text
"fill-colour" is not in the MapLibre Style Specification. Did you mean: fill-color?
```

For a name it knows, it returns the documentation, and the versions of GL JS and MapLibre Native that support each part:

```text
fill-extrusion-height (paint property of fill-extrusion layers)
The height with which to extrude this layer. Negative values extrude below ground level, so a floor that is entirely underground can be expressed.
Type: number. Default: 0. Units: meters. Transitionable.
Expressions can use zoom, feature, feature-state, and the value can be interpolated.
Support:
  basic functionality: GL JS 0.27.0, Android 5.1.0, iOS 3.6.0
  data-driven styling: GL JS 0.27.0, Android 5.1.0, iOS 3.6.0
  [`global-state`](https://maplibre.org/maplibre-style-spec/expressions/#global-state) expression: GL JS 5.6.0, Android not yet (https://github.com/maplibre/maplibre-native/issues/3302), iOS not yet (https://github.com/maplibre/maplibre-native/issues/3302)
  negative values: GL JS not yet (https://github.com/maplibre/maplibre-gl-js/issues/8051), Android not yet (https://github.com/maplibre/maplibre-native/issues/4455), iOS not yet (https://github.com/maplibre/maplibre-native/issues/4455)
```

## Look up the GL JS API

Models write GL JS code from memory, which mixes in Mapbox GL JS methods and older versions. `describe_gl_js_api` answers from the type definitions of the GL JS version the server renders with, so it says when a method isn't there:

```text
Map has no member "setFog" in MapLibre GL JS 6.11.2.
```

For a name it knows, it returns the signature, documentation, default and examples, with a link to the docs page:

```text
MapOptions.maxPitch (property of MapOptions, MapLibre GL JS 6.11.2)
maxPitch?: number | null
The maximum pitch of the map (0-180).
Default: 60
Docs: https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/#maxpitch
```

For a class or an options type, it lists the members. With `version`, it answers for another GL JS version instead, like the `"5"` a project uses.

## Compare GL JS and MapLibre Native

With the `gl-js` and `native` toolsets on, `compare_renderers` draws one style with both, to check that it looks the same on the web and in the mobile SDKs:

```json
{
  "url": "https://tiles.openfreemap.org/styles/liberty",
  "center": [12.5862, 55.6798],
  "zoom": 15.2,
  "bearing": -25,
  "pitch": 55,
  "width": 420,
  "height": 300
}
```

![Copenhagen in 3D, drawn by MapLibre GL JS and by MapLibre Native, with a third panel marking the few pixels that differ](/maplibre-mcp/images/compare-renderers.webp)

```text
Left to right: gl-js, native, and the differences in red.
3.07% of the pixels differ (3866 of 126000).
Camera: center [12.5862, 55.6798], zoom 15.2, bearing -25, pitch 55.
gl-js: Rendered with MapLibre GL JS 6.11.2.
native: Rendered with MapLibre Native 6.5.0-pre.1.
```

The two agree, apart from where a few labels land.

## Show the user a map

`show_map` puts an interactive map in the chat, in clients that support MCP Apps. The live map on the [home page](/maplibre-mcp/) draws what this call shows, a walk from Nyhavn to Tivoli:

```json
{
  "layers": [
    {
      "type": "fill",
      "data": {"type": "Polygon", "coordinates": [[[12.566, 55.6746], [12.5705, 55.6744], [12.5712, 55.6727], [12.5669, 55.6718], [12.5655, 55.673], [12.566, 55.6746]]]},
      "paint": {"fill-color": "#e53935", "fill-opacity": 0.25}
    },
    {
      "type": "line",
      "data": {"type": "LineString", "coordinates": [[12.5903, 55.6798], [12.5856, 55.6797], [12.5822, 55.6786], [12.5776, 55.678], [12.5747, 55.677], [12.5708, 55.6761], [12.5694, 55.6757], [12.5683, 55.6746]]},
      "paint": {"line-color": "#295daa", "line-width": 5},
      "layout": {"line-cap": "round", "line-join": "round"}
    }
  ],
  "markers": [
    {"position": [12.5903, 55.6798], "label": "Nyhavn", "color": "#295daa"},
    {"position": [12.5683, 55.6746], "label": "Tivoli", "color": "#e53935"}
  ]
}
```

The agent gets a short confirmation back, since only the user sees the map:

```text
Showing the user a map with 2 layers and 2 markers.
```

## Pick libraries and map data for an app

With the `ecosystem` toolset, the agent answers "what should I use?" from [Make with MapLibre](https://makewithmaplibre.com). In this Claude Code session, only its two tools were available. The prompt was:

> I'm building a hiking web app in React. I want a MapLibre map with a free basemap and 3D terrain, and users should be able to draw a planned route on it. Which libraries and map data should I use, and how do I set them up?

The agent searched for each part of the question, with these calls to `search_ecosystem`:

```json
{"query": "react", "platform": "Web"}
{"query": "draw", "kind": "plugin"}
{"kind": "routing"}
```

And these to `find_basemaps`:

```json
{"free": true}
{"query": "terrain"}
{"query": "elevation"}
```

The search for drawing plugins returned eight, the first two here:

```text
8 entries match "draw", kind plugin:

maplibre-gl-terradraw (plugin, drawing): Drawing and measuring toolbar on Terra Draw
  A MapLibre GL JS control that puts Terra Draw behind a ready-made toolbar: points, lines, polygons, circles, freehand and text, with select, undo, GeoJSON download, and a measuring variant.
  Web · JavaScript, TypeScript · MapLibre GL JS · MIT
  https://github.com/watergis/maplibre-gl-terradraw, docs https://terradraw.water-gis.com/, npm https://www.npmjs.com/package/@watergis/maplibre-gl-terradraw
  Live demo: https://makewithmaplibre.com/plugins/maplibre-gl-terradraw/#live-demo
  More: https://makewithmaplibre.com/plugins/maplibre-gl-terradraw/

Terra Draw (plugin, drawing): Multi-library drawing tool
  A cross-library drawing tool that works with MapLibre GL JS, Leaflet, OpenLayers, and Google Maps. Draw and edit geometries with a consistent API.
  Web · JavaScript, TypeScript · MapLibre GL JS · MIT
  https://github.com/JamesLMilner/terra-draw, docs https://terradraw.io, npm https://www.npmjs.com/package/terra-draw
  Live demo: https://makewithmaplibre.com/plugins/terra-draw/#live-demo
  More: https://makewithmaplibre.com/plugins/terra-draw/
```

The search for terrain found elevation tiles, with how to add them and the credit they need:

```text
Terrarium Elevation by AWS Open Data, free, no API key: Global elevation tiles in Terrarium format. Use for hillshading and 3D terrain in MapLibre.
  Tiles, to add as a raster-dem source with tileSize 256: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
  Elevation encoding: terrarium
  More: https://makewithmaplibre.com/basemaps/styles/aws-terrarium/

Mapterhorn Terrain by Mapterhorn, free, no API key: Open elevation tiles in Terrarium format: 30 m worldwide and 1 m or finer where countries publish lidar data. Free with no API key; credit Mapterhorn and its sources. Use for hillshading and 3D terrain in MapLibre.
  Tiles, to add as a raster-dem source with tileSize 512: https://tiles.mapterhorn.com/{z}/{x}/{y}.webp
  Elevation encoding: terrarium
  Attribution the map has to show: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>
  More: https://makewithmaplibre.com/basemaps/styles/mapterhorn/
```

It recommended this stack, with setup code for each part:

| Need | Pick | Why |
|---|---|---|
| Map renderer | `maplibre-gl` | The core library |
| React binding | [React Map GL](https://visgl.github.io/react-map-gl/) (`react-map-gl/maplibre`) | Most widely used declarative wrapper, MIT |
| Basemap | [Maptoolkit Hiking](https://makewithmaplibre.com/basemaps/styles/maptoolkit-hiking/) | Free, no API key, trails brought forward, hillshading and contour lines |
| Elevation | [Mapterhorn Terrain](https://makewithmaplibre.com/basemaps/styles/mapterhorn/) | Free, no API key, 30 m worldwide and 1 m or finer where lidar exists |
| Drawing | [maplibre-gl-terradraw](https://makewithmaplibre.com/plugins/maplibre-gl-terradraw/) | Ready-made toolbar on Terra Draw, with select, undo, and GeoJSON download |

It passed on what the providers require: Maptoolkit's logo control, and Mapterhorn's attribution, with `tileSize` 512 and the `terrarium` encoding in the `raster-dem` source. For drawing routes that follow trails, it pointed to Valhalla, GraphHopper and openrouteservice from the routing search. It ended with the credit the tools ask for:

> Sources: [Make with MapLibre](https://makewithmaplibre.com/) by Birk Skyum, CC BY 4.0.

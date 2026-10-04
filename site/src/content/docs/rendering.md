---
title: Rendering
description: The three renderers, what each one needs, and how the camera and comparisons work.
---

`render_style`, `compare_styles` and `compare_renderers` draw with a renderer from the toolsets that are on. The `gl-js`, `native` and `martin` toolsets each add one, and the tools take a `renderer` argument to choose between them. The first renderer toolset in `--toolsets` is the default.

## MapLibre GL JS

The `gl-js` toolset draws with the MapLibre GL JS that is installed with the server, in a headless browser. It uses Google Chrome, and without Chrome the Chromium that Playwright installs. On a machine without a GPU, Chrome falls back to software WebGL, which is slower.

It waits until the map has loaded, for up to 30 seconds, and then reports the errors the map raised, the font stacks whose glyphs did not load, and the images the style uses but its sprite lacks. It reads PMTiles sources, with `pmtiles://` URLs, as well as tiles over HTTP.

Over 3D terrain, a center and zoom are hard to guess for a view like "the Matterhorn from above Zermatt". `render_style` also takes `cameraPosition`, the longitude, latitude and altitude of the camera, and `lookAt`, the point on the ground it looks at. The result gives the center, zoom, bearing and pitch of that view, to store in the style.

### Pages

A style cannot hold everything a map shows. Plugins like contour lines, controls and the code of the page are outside it. `render_page` takes an HTML file or the URL of a page, loads it in the same headless browser and returns a screenshot, with the errors and warnings of the page and the requests that failed. An HTML file is served together with the files in its folder.

When the page keeps its map in `window.map`, the screenshot waits until that map has drawn everything, the result has its camera, and `script` can use the map before the screenshot:

```json
{"path": "index.html", "script": "map.jumpTo({center: [7.66, 45.98], zoom: 12, pitch: 60})"}
```

A server that other machines can reach does not load pages.

### Showing the map to the user

`preview_style` gives the user a link to an interactive map of a style, served by the server on their machine. The agent has no viewer page to write, no web server to start and no browser to open. Given a file, the map follows it and redraws when the file changes, so the link can stay open while the agent works. It lasts as long as the server runs.

In a container, the user's browser cannot reach the server's own address. Publish a port and name it in `MAPLIBRE_MCP_PREVIEW_PORT`, like `docker run -p 3210:3210 -e MAPLIBRE_MCP_PREVIEW_PORT=3210`, and the link uses it. Without one, `preview_style` says so instead of giving a link that does not open.

### When a style does not load

A render where the map reports errors, like a source that does not exist, comes back as an error after a few seconds, with the reason before the image. It names each source that failed, and says which tools find sources that exist.

## MapLibre Native

The `native` toolset draws with MapLibre Native, the engine of the MapLibre iOS and Android SDKs, through `@maplibre/maplibre-gl-native`. That package has builds for macOS, Windows and Ubuntu 24.04, and has to be installed next to the server:

```sh
npx -y -p maplibre-mcp -p @maplibre/maplibre-gl-native maplibre-mcp --toolsets style,gl-js,native
```

In a client's JSON configuration, that is:

```json
{
  "mcpServers": {
    "maplibre": {
      "command": "npx",
      "args": ["-y", "-p", "maplibre-mcp", "-p", "@maplibre/maplibre-gl-native", "maplibre-mcp", "--toolsets", "style,gl-js,native"]
    }
  }
}
```

On Node.js 26, use `@maplibre/maplibre-gl-native@next`. On Ubuntu, the build needs these libraries:

```sh
sudo apt-get install libopengl0 libglx0 libjpeg-turbo8 libuv1t64 libx11-6 libxext6 libwebp7 libicu74 libpng16-16t64
```

It also needs a display, so on a server without one, start maplibre-mcp with `xvfb-run -a`.

MapLibre Native doesn't draw terrain, the sky or projections other than Mercator yet. When a style uses them, the result says so, so that a difference from GL JS isn't taken for a bug. The Native renderer here can't read PMTiles sources yet.

## Martin

The `martin` toolset draws with a [Martin](https://martin.maplibre.org) tile server, which renders with MapLibre Native on Linux. It draws the styles Martin serves, so pass the style as a URL like `http://localhost:3000/style/<id>`. Martin picks up changes to its style files right away, so an agent can edit a style file and render it again.

Rendering needs a Martin build with it, like the `nightly-full` Docker image, and this in Martin's configuration:

```yaml
styles:
  paths:
    - /path/to/styles
  rendering: true
```

`martin_list_sources` lists the sources, sprites, fonts and styles of the server at `MARTIN_URL`, or `http://localhost:3000`. `inspect_tile` reads the tiles of a Martin source from its TileJSON URL, like `http://localhost:3000/roads`, and lists the values of its fields.

## Camera and size

Without a camera in the call, the renderers use the center, zoom, bearing and pitch stored in the style. `center`, `zoom`, `bearing` and `pitch` override them. `bounds` fits the map to `[west, south, east, north]` instead, with 32 pixels of padding and at most zoom 18. The camera is worked out once and passed to every renderer, so comparisons line up.

`render_style` draws 800 by 600 pixels by default, and up to 2048 on each side. The comparisons draw each image 512 by 384 by default, and up to 1024 on each side.

## Comparisons

`compare_styles` and `compare_renderers` return one image with three panels side by side. The third one shows the first image faded, with the pixels that differ in red. Pixels that differ only by antialiasing are marked in yellow and don't count, and small differences in color are ignored, with [pixelmatch](https://github.com/mapbox/pixelmatch) at a threshold of 0.1. The text gives the share of pixels that differ.

`compare_renderers` leaves out the attribution, since only GL JS draws it.

# maplibre-mcp

An MCP server that lets AI agents check, render and show [MapLibre](https://maplibre.org) styles.

It validates styles against the MapLibre Style Specification, looks up properties and expressions, checks that layers match the data in their sources, and renders styles with MapLibre GL JS, MapLibre Native or a Martin server, so an agent can see what it built and what a change did. In chats that support MCP Apps, it also shows the user an interactive map.

Everything runs on your machine, and no API key is needed.

## Setup

Claude Code:

```sh
claude mcp add maplibre -- npx -y maplibre-mcp
```

Claude Desktop, Cursor and most other clients:

```json
{
  "mcpServers": {
    "maplibre": {
      "command": "npx",
      "args": ["-y", "maplibre-mcp"]
    }
  }
}
```

Rendering with MapLibre GL JS uses the installed Google Chrome. Without Chrome, install Playwright's Chromium with `npx playwright-core install chromium`.

To run it as a remote server over Streamable HTTP, start it with `--http`. It listens on `http://127.0.0.1:3100/mcp`, and `--host` and `--port` change that. On a loopback address it only answers requests from localhost. It has no authentication, so on any other address, put it behind a proxy that has.

## Toolsets

The tools are grouped by the MapLibre project they belong to. `style` and `gl-js` are on by default. Choose others with `--toolsets`, or with the `MAPLIBRE_MCP_TOOLSETS` environment variable:

```sh
npx -y maplibre-mcp --toolsets style,gl-js,martin
```

| Toolset | Tools |
| --- | --- |
| `style` | `validate_style`, `describe_style_spec`, `describe_sources`, `format_style`, `migrate_style` |
| `gl-js` | `show_map`, and rendering with MapLibre GL JS |
| `native` | Rendering with MapLibre Native |
| `martin` | `martin_list_sources`, and rendering with a Martin server |

`all` turns on every toolset. With any renderer on, there are `render_style` and `compare_styles`, and with two or more, `compare_renderers`.

## Tools

- `validate_style` checks a style against the MapLibre Style Specification, and lists each problem with the path to its property.
- `describe_style_spec` looks up a layer type, property, source type or expression, with its documentation and the GL JS and Native versions that support it. For a misspelled name, or a Mapbox property MapLibre does not have, it suggests the closest real ones.
- `describe_sources` reads the TileJSON, PMTiles header or GeoJSON of each source in a style, lists the source layers and fields, and finds layers that use a source layer or field that is not there.
- `format_style` and `migrate_style` do what `gl-style-format` and `gl-style-migrate` do. Given a file, they rewrite it.
- `render_style` renders a style to a PNG, and reports map errors and missing icons. It takes a center, zoom, bearing and pitch, or bounds to fit.
- `compare_styles` renders two versions of a style at the same camera, and returns one image with the style before, after, and their differences in red.
- `compare_renderers` does the same for one style in two renderers, for example to check that a style looks the same on the web and on mobile.
- `show_map` shows the user an interactive map with GeoJSON layers and markers on an [OpenFreeMap](https://openfreemap.org) basemap.
- `martin_list_sources` lists the tiles, sprites, fonts and styles a [Martin](https://martin.maplibre.org) server serves, with the URLs to use in a style. It asks `MARTIN_URL`, or `http://localhost:3000`.

The tools that take a style accept it as an object (`style`), a URL (`url`) or a file (`path`, relative to where the server runs).

## MapLibre Native

The `native` toolset needs `@maplibre/maplibre-gl-native`, which has builds for macOS, Windows and Ubuntu 24.04. Install it next to the server:

```sh
npx -y -p maplibre-mcp -p @maplibre/maplibre-gl-native maplibre-mcp --toolsets style,gl-js,native
```

On Node.js 26, use `@maplibre/maplibre-gl-native@next`. On Ubuntu, the build needs these libraries:

```sh
sudo apt-get install libopengl0 libglx0 libjpeg-turbo8 libuv1t64 libx11-6 libxext6 libwebp7 libicu74 libpng16-16t64
```

It also needs a display, so on a server without one, start the server with `xvfb-run -a`.

MapLibre Native does not draw terrain, the sky or the globe yet, and `render_style` says so when a style uses them.

## Martin

With the `martin` toolset, the renderers can include a Martin server, which renders with MapLibre Native on Linux. It draws the styles Martin serves, so pass the style as `url: "http://localhost:3000/style/<id>"`. Martin picks up changes to its style files right away, so an agent can edit a style file and render it again.

Rendering needs a Martin build with it, like the `nightly-full` Docker image, and this in Martin's configuration:

```yaml
styles:
  paths:
    - /path/to/styles
  rendering: true
```

## Development

```sh
npm install
npm test
```

## License

MIT

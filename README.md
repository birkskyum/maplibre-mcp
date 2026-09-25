# maplibre-mcp

An MCP server that lets AI agents check, render and show [MapLibre](https://maplibre.org) styles.

![A MapLibre style before and after an agent turned its motorways red, and the pixels that changed](https://raw.githubusercontent.com/birkskyum/maplibre-mcp/main/site/public/images/compare-z10.webp)

An agent turned the motorways in OpenFreeMap's Liberty style red, and `compare_styles` showed it the map before, after, and the pixels that changed.

Coding agents like Claude Code, Codex and Cursor can edit a MapLibre style, but they can't see the map, and they can mix up MapLibre and Mapbox. With maplibre-mcp, an agent can validate a style against the MapLibre Style Specification, render it with MapLibre GL JS, MapLibre Native or a Martin server, compare two versions of it, and show you an interactive map in the chat. It runs on your machine and needs no API key.

**[Website](https://birkskyum.github.io/maplibre-mcp/)** · [Getting started](https://birkskyum.github.io/maplibre-mcp/getting-started/) · [Examples](https://birkskyum.github.io/maplibre-mcp/examples/) · [Tools](https://birkskyum.github.io/maplibre-mcp/tools/)

## Install

It needs Node.js 22 or newer.

| Client | Command |
| --- | --- |
| Claude Code | `claude mcp add maplibre -- npx -y maplibre-mcp` |
| Codex | `codex mcp add maplibre -- npx -y maplibre-mcp` |
| Gemini CLI | `gemini mcp add maplibre npx -- -y maplibre-mcp` |
| Grok | `grok mcp add maplibre -- npx -y maplibre-mcp` |
| VS Code | `code --add-mcp '{"name": "maplibre", "command": "npx", "args": ["-y", "maplibre-mcp"]}'` |

Claude Desktop, Cursor, Windsurf and most other clients read this JSON. [Getting started](https://birkskyum.github.io/maplibre-mcp/getting-started/) says where each one keeps it.

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

Rendering with MapLibre GL JS uses the installed Google Chrome. Without Chrome, the first render fails with the command that installs the Chromium it can use instead.

## Command line

Agents that work in a shell, and people, can also run the rendering and data tools as commands, without setting up MCP. A style is a file or a URL.

```sh
npx -y maplibre-mcp render style.json --center 12.57,55.68 --zoom 12
npx -y maplibre-mcp compare before.json after.json --zoom 10
npx -y maplibre-mcp compare-renderers style.json --renderers gl-js,native
npx -y maplibre-mcp describe-sources style.json
npx -y maplibre-mcp inspect-tile https://tiles.openfreemap.org/planet --center 12.57,55.68 --zoom 14
```

The images go to `map.png`, `compare.png` and `renderers.png`, or to `--out`. `npx -y maplibre-mcp --help` lists the options, and [Command line](https://birkskyum.github.io/maplibre-mcp/command-line/) has the details. To validate, format or migrate a style, use `gl-style-validate`, `gl-style-format` and `gl-style-migrate` from `@maplibre/maplibre-gl-style-spec`.

## Tools

- `validate_style` checks a style against the MapLibre Style Specification, and lists each problem with the path to its property.
- `describe_style_spec` looks up a layer type, property, source type or expression, with its documentation and the GL JS and Native versions that support it. For a misspelled name, it suggests the closest real ones.
- `describe_sources` reads the TileJSON, PMTiles header or GeoJSON of each source in a style, lists the source layers and fields, and finds layers that use a source layer or field that is not there.
- `inspect_tile` reads the vector tile at a place and lists each source layer with its geometry types, the values of its fields and how often they occur, and a few example features. The source can be a source in a style, a TileJSON URL like a Martin source, a PMTiles archive or a tile URL, with MVT or MLT tiles.
- `format_style` and `migrate_style` do what `gl-style-format` and `gl-style-migrate` do. Given a file, they rewrite it.
- `render_style` renders a style to a PNG, and reports map errors and missing icons. It takes a center, zoom, bearing and pitch, or bounds to fit.
- `compare_styles` renders two versions of a style at the same camera, and returns one image with the style before, after, and their differences in red.
- `compare_renderers` does the same for one style in two renderers, for example to check that a style looks the same on the web and on mobile.
- `show_map` shows the user an interactive map with GeoJSON layers and markers on an [OpenFreeMap](https://openfreemap.org) basemap, in clients that support MCP Apps.
- `martin_list_sources` lists the tiles, sprites, fonts and styles a [Martin](https://martin.maplibre.org) server serves, with the URLs to use in a style.

The tools that take a style accept it as an object (`style`), a URL (`url`) or a file (`path`, relative to where the server runs). The [tool reference](https://birkskyum.github.io/maplibre-mcp/tools/) lists every parameter.

## Toolsets

The tools are grouped by the MapLibre project they belong to. `style` and `gl-js` are on by default. Choose others with `--toolsets`, or with the `MAPLIBRE_MCP_TOOLSETS` environment variable, and `all` turns on every toolset:

```sh
npx -y maplibre-mcp --toolsets style,gl-js,martin
```

| Toolset | What it adds |
| --- | --- |
| `style` | `validate_style`, `describe_style_spec`, `describe_sources`, `inspect_tile`, `format_style`, `migrate_style` |
| `gl-js` | Rendering with MapLibre GL JS, and `show_map` |
| `native` | Rendering with MapLibre Native |
| `martin` | Rendering with a Martin server, and `martin_list_sources` |

With any renderer on, there are `render_style` and `compare_styles`, and with two or more, `compare_renderers`. Rendering with MapLibre Native needs one more package, and rendering with Martin needs a Martin build with rendering. [Rendering](https://birkskyum.github.io/maplibre-mcp/rendering/) covers both.

## Remote server

`--http` serves Streamable HTTP at `http://127.0.0.1:3100/mcp` instead of stdio, and `--host` and `--port` change the address. On a loopback address it only answers requests from localhost. On any other address it does not read or write files, it still fetches the URLs it is given from its own network, and it has no authentication, so put it behind a proxy that has. [Remote server](https://birkskyum.github.io/maplibre-mcp/remote-server/) has the details.

## Development

```sh
npm install
npm test
npm run dev:site
```

## License

MIT © 2026 [Birk Skyum](https://github.com/birkskyum)

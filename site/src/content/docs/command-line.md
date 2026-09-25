---
title: Command line
description: Render and compare MapLibre styles, and inspect vector tiles, from a shell, without setting up MCP.
---

Agents that work in a shell, and people, can also run the rendering and data tools as commands. Each command runs one tool and exits, so nothing has to be set up in an AI client first.

```sh
npx -y maplibre-mcp render style.json --center 12.57,55.68 --zoom 12
```

A style is a file or a URL. The commands that render write the image to a file, and every command prints what the tool reports.

## Commands

| Command | What it does |
| --- | --- |
| `render <style>` | Renders the style to `map.png`, and reports map errors and missing icons |
| `compare <before> <after>` | Renders two versions of a style to `compare.png`, with the pixels that differ in red |
| `compare-renderers <style>` | Renders the style with two renderers to `renderers.png`, with the pixels that differ in red |
| `describe-sources <style>` | Lists the source layers and fields of each source, and the layers that use ones that are not there |
| `debug-layers <style>` | Says which layers draw at a place, and why the others draw nothing |
| `inspect-tile <source>` | Lists the source layers, geometry types and field values of the vector tile at a place |

## Options

The commands that render take the same camera and size as the tools. Without a camera, they use the one stored in the style.

| Option | Example |
| --- | --- |
| `--center <lng,lat>` | `--center 12.57,55.68` |
| `--zoom <zoom>` | `--zoom 12` |
| `--bearing <degrees>` and `--pitch <degrees>` | `--bearing -25 --pitch 55` |
| `--bounds <west,south,east,north>` | `--bounds 12.45,55.6,12.7,55.75` fits the map to the bounds, instead of `--center` and `--zoom` |
| `--width <pixels>` and `--height <pixels>` | `--width 1024 --height 768` |
| `--renderer <name>` | `--renderer native` draws with MapLibre Native, as [Rendering](/maplibre-mcp/rendering/) describes |
| `--renderers <first,second>` | `--renderers gl-js,native` for `compare-renderers` |
| `--out <file>` | `--out copenhagen.png` |

## Debug layers

`debug-layers` checks every layer of the style at the place, or at the style's own center and zoom. `--layers` checks only the layers named.

```sh
npx -y maplibre-mcp debug-layers style.json --center 12.57,55.68 --zoom 14 --layers buildings,motorways
```

## Inspect a tile

`inspect-tile` reads a TileJSON URL, a PMTiles archive or a tile URL with `{z}`, `{x}` and `{y}`. With `--source`, it reads that source of the style given instead. Without `--center` and `--zoom`, it reads the source's center at its highest zoom.

```sh
npx -y maplibre-mcp inspect-tile https://tiles.openfreemap.org/planet --center 12.57,55.68 --zoom 14 --layer transportation
npx -y maplibre-mcp inspect-tile style.json --source openmaptiles --center 12.57,55.68 --zoom 14
```

| Option | Example |
| --- | --- |
| `--source <id>` | `--source openmaptiles` reads that source of the style |
| `--layer <name>` | `--layer transportation` lists only that source layer |
| `--examples <count>` | `--examples 0` leaves out the example features, of which it shows 3 |

## Validate, format and migrate

The MapLibre style spec package has commands for these already, so maplibre-mcp doesn't repeat them. `gl-style-validate` exits with an error when it finds problems, and the other two print the new style.

```sh
npx -y -p @maplibre/maplibre-gl-style-spec gl-style-validate style.json
npx -y -p @maplibre/maplibre-gl-style-spec gl-style-format style.json
npx -y -p @maplibre/maplibre-gl-style-spec gl-style-migrate style.json
```

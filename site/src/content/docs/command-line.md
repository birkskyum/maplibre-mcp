---
title: Command line
description: Render and compare MapLibre styles from a shell, without setting up MCP.
---

Agents that work in a shell, and people, can also run the rendering tools as commands. Each command runs one tool and exits, so nothing has to be set up in an AI client first.

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

## Validate, format and migrate

The MapLibre style spec package has commands for these already, so maplibre-mcp doesn't repeat them. `gl-style-validate` exits with an error when it finds problems, and the other two print the new style.

```sh
npx -y -p @maplibre/maplibre-gl-style-spec gl-style-validate style.json
npx -y -p @maplibre/maplibre-gl-style-spec gl-style-format style.json
npx -y -p @maplibre/maplibre-gl-style-spec gl-style-migrate style.json
```

---
title: Troubleshooting
description: The errors maplibre-mcp reports, and how to fix them.
---

The tools report problems in words the agent can act on, so it often fixes them itself. These are the messages that need you.

## The agent doesn't use the tools

Check that the client lists the server and its tools, with `claude mcp list` in Claude Code or the MCP settings of other clients. Most clients only read their configuration when they start, so restart the client after changing it.

## Rendering with GL JS

```text
Rendering with MapLibre GL JS needs Google Chrome or the Chromium that Playwright installs. Install Chrome, or run: npx playwright-core@<version> install chromium
```

Install Google Chrome, or run the command in the message. It names the Playwright version the server uses, which has to match the Chromium it downloads.

```text
The map did not finish loading within 30 seconds, so the image may be incomplete.
```

The tiles or other resources of the style loaded slowly or not at all. Check that the URLs in the style work, and render again.

## Rendering with MapLibre Native

```text
Rendering with MapLibre Native needs the @maplibre/maplibre-gl-native package next to maplibre-mcp
```

Start the server with the package next to it, as [Rendering](/maplibre-mcp/rendering/#maplibre-native) shows.

```text
The installed @maplibre/maplibre-gl-native has no build for Node.js v26.3.0
```

The package only has builds for some Node.js versions. Install it with the Node.js version that runs the server, and on Node.js 26, use `@maplibre/maplibre-gl-native@next`.

```text
MapLibre Native could not load a system library
```

On Ubuntu 24.04, install the libraries the message lists. On a machine without a display, start the server with `xvfb-run -a`.

## Rendering with Martin

```text
The martin renderer draws the styles that a Martin server serves, so pass the style as url: "<martin>/style/<id>".
```

The Martin renderer asks Martin to draw one of its own styles, so the style has to be a Martin style URL rather than an object or a file.

```text
Martin answered 404 for …
```

Check that Martin serves the style, and that it has rendering. That needs a Martin build with it, like the `nightly-full` Docker image, and `rendering: true` under `styles` in Martin's configuration.

## Styles and files

```text
Pass exactly one of style, url and path.
```

The tools that take a style need it in exactly one way.

```text
MapLibre does not resolve mapbox:// URLs
```

Styles made for Mapbox can point to `mapbox://` resources, which MapLibre can't load. Use the https URLs of the resources, or other ones.

```text
This server does not read or write files, since other machines can reach it. Pass the style as an object or a URL.
```

A server started with `--http` on an address other than loopback doesn't read or write files. See [Remote server](/maplibre-mcp/remote-server/).

## Maps in the chat

`show_map` needs a client that supports MCP Apps. In other clients, including terminal clients like Claude Code, the agent gets its short reply and you see no map. The agent can still look at a map with `render_style`.

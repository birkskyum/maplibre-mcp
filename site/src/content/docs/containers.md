---
title: Containers and sandboxes
description: Run maplibre-mcp from its container image, for agents in a sandbox and for CI, where no browser can be installed.
---

An agent in a sandbox can write a style, but it has no browser to render it with and often may not install one. The container image has the server together with the Chromium it renders with:

```sh
docker pull ghcr.io/birkskyum/maplibre-mcp
```

It has builds for `amd64` and `arm64`, and a tag for each release, like `ghcr.io/birkskyum/maplibre-mcp:0.9.1`.

## As the server of a client

A client starts the container the way it starts any stdio server. Mount the folder with the styles as the working directory, so that the paths the agent passes are the same inside and outside:

```json
{
  "mcpServers": {
    "maplibre": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "/path/to/project:/work", "-w", "/work", "ghcr.io/birkskyum/maplibre-mcp"]
    }
  }
}
```

The agent then passes paths relative to that folder, like `style.json`. A path that only exists outside the container is answered with where the server looked.

## The preview link

`preview_style` gives the user a link to a live map, and their browser has to reach it. Publish a port and name it:

```sh
docker run -i --rm -p 3210:3210 -e MAPLIBRE_MCP_PREVIEW_PORT=3210 -v "$PWD:/work" -w /work ghcr.io/birkskyum/maplibre-mcp
```

The link is then `http://localhost:3210/preview/...`. Without a published port, `preview_style` says so instead of giving a link that does not open.

## Over HTTP

For a sandbox that cannot start containers itself, run the server outside it and connect over [HTTP](/maplibre-mcp/remote-server/):

```sh
docker run --rm -p 3100:3100 ghcr.io/birkskyum/maplibre-mcp --http --host 0.0.0.0
```

A server that other machines can reach reads no files and loads no pages, so the agent passes each style as an object or a URL.

## In CI

The commands of the [command line](/maplibre-mcp/command-line/) work the same way, for example to render a style in a pull request:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work ghcr.io/birkskyum/maplibre-mcp render style.json --out map.png
```

`--user` lets the container write the image into a folder that belongs to the user who runs it.

## Rendering without a GPU

In a container Chromium draws with software WebGL. A style with 3D terrain takes about five seconds to render that way, and a view placed with `cameraPosition` and `lookAt` about fifteen.

---
title: Remote server
description: Run maplibre-mcp over Streamable HTTP, and what it allows on a network.
section: guide
order: 5
---

Usually the client starts maplibre-mcp itself and talks to it over stdio. With `--http`, it runs as a server that clients connect to over Streamable HTTP instead:

```sh
npx -y maplibre-mcp --http
```

It listens on `http://127.0.0.1:3100/mcp`. `--host` and `--port` change the address, and `--toolsets` works as usual. To connect Claude Code to it:

```sh
claude mcp add --transport http maplibre http://127.0.0.1:3100/mcp
```

## On your own machine

On a loopback address, `127.0.0.1`, `localhost` or `::1`, the server only answers requests addressed to localhost, and requests from web pages only when the page is on localhost too. That keeps the other web pages you visit from reaching it through DNS rebinding.

## On a network

With any other `--host`, like `0.0.0.0`, other machines can reach the server, so it works differently:

- It doesn't read or write files. The tools take styles as objects and URLs, and refuse a `path`.
- It still fetches the URLs it is given, from its own network. Don't run it where that network has services that others shouldn't reach.
- It has no authentication, so put it behind a proxy that has.

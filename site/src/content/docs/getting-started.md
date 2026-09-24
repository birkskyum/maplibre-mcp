---
title: Getting started
description: Add maplibre-mcp to your AI client, and try it on a style.
---

maplibre-mcp is an MCP server for MapLibre. Your AI client starts it on your machine, and the agent gets tools to validate styles, look up the MapLibre Style Specification, render and compare styles, and show you maps. It needs Node.js 22 or newer, and no API key.

## Add it to your client

### Claude Code

```sh
claude mcp add maplibre -- npx -y maplibre-mcp
```

This adds it for you in the current project. Add `--scope user` to have it in all your projects, or `--scope project` to share it with everyone in the repository through `.mcp.json`.

### Codex

```sh
codex mcp add maplibre -- npx -y maplibre-mcp
```

### Gemini CLI

```sh
gemini mcp add maplibre npx -- -y maplibre-mcp
```

This adds it to the current project. Add `-s user` to have it in all your projects.

### Grok

```sh
grok mcp add maplibre -- npx -y maplibre-mcp
```

This adds it for your user. Add `--scope project` to add it to the current project only.

### VS Code

```sh
code --add-mcp '{"name": "maplibre", "command": "npx", "args": ["-y", "maplibre-mcp"]}'
```

Or add it to `.vscode/mcp.json` in your workspace, or to your user configuration with the **MCP: Open User Configuration** command:

```json
{
  "servers": {
    "maplibre": {
      "command": "npx",
      "args": ["-y", "maplibre-mcp"]
    }
  }
}
```

### Cursor

[Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=maplibre&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1hcGxpYnJlLW1jcCJdfQ==) opens Cursor, which adds it after you confirm. You can also add the JSON below to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project.

### Claude Desktop, Windsurf and others

Most other clients read this JSON. Claude Desktop keeps it in `claude_desktop_config.json`, which **Settings › Developer › Edit Config** opens.

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

## Choose toolsets

The tools come in toolsets, one for each MapLibre project. `style` and `gl-js` are on by default. Choose others with `--toolsets`, or with the `MAPLIBRE_MCP_TOOLSETS` environment variable, and `all` turns on every toolset:

```sh
claude mcp add maplibre -- npx -y maplibre-mcp --toolsets style,gl-js,martin
```

| Toolset | What it adds |
| --- | --- |
| `style` | Validating, formatting and migrating styles, looking up the style specification, and checking sources |
| `gl-js` | Rendering with MapLibre GL JS, and showing the user maps with `show_map` |
| `native` | Rendering with MapLibre Native, which needs one more package |
| `martin` | Listing what a Martin server serves, and rendering with it |

[Tools](/maplibre-mcp/tools/) lists every tool with its parameters, and [Rendering](/maplibre-mcp/rendering/) covers what each renderer needs.

## Try it

Open a project with a MapLibre style, and ask for something like this:

> Check that style.json is valid, then render it around Copenhagen at zoom 12.

> Make the motorways red in style.json. Check that the style is still valid, and show me a before and after.

The agent picks the tools itself. [Examples](/maplibre-mcp/examples/) shows what it does with prompts like these.

Rendering with MapLibre GL JS uses Google Chrome. Without Chrome, the first render fails with the command that installs the Chromium it can use instead.

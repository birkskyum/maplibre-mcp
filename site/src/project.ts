/** What maplibre-mcp is, in one paragraph, for search engines and language models. */
export const SUMMARY = [
    'maplibre-mcp is an MCP server that lets AI agents check, render and show MapLibre styles.',
    'It validates styles against the MapLibre Style Specification, renders them with MapLibre GL JS, MapLibre Native or a Martin server,',
    'compares two versions of a style or two renderers, and shows interactive maps in clients that support MCP Apps.',
    'It runs locally with npx and needs no API key.',
].join(' ');

export const SERVER_CONFIG = {command: 'npx', args: ['-y', 'maplibre-mcp']};

/** One-line setups for the clients whose command line adds MCP servers. */
export const INSTALL_COMMANDS = [
    {client: 'Claude Code', command: 'claude mcp add maplibre -- npx -y maplibre-mcp'},
    {client: 'Codex', command: 'codex mcp add maplibre -- npx -y maplibre-mcp'},
    {client: 'Gemini CLI', command: 'gemini mcp add maplibre npx -- -y maplibre-mcp'},
    {client: 'Grok', command: 'grok mcp add maplibre -- npx -y maplibre-mcp'},
    {client: 'VS Code', command: `code --add-mcp '{"name": "maplibre", "command": "npx", "args": ["-y", "maplibre-mcp"]}'`},
];

export const CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=maplibre&config=${btoa(JSON.stringify(SERVER_CONFIG))}`;

/** The configuration that Claude Desktop, Windsurf and most other clients read. */
export const CLIENT_JSON = `{
  "mcpServers": {
    "maplibre": {
      "command": "npx",
      "args": ["-y", "maplibre-mcp"]
    }
  }
}`;

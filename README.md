# vikunja-mcp

A minimal, self-owned [MCP](https://modelcontextprotocol.io/) server for
[Vikunja](https://vikunja.io/), built to be small enough to read in one sitting.

## Why this exists

The available third-party Vikunja MCP servers pull a dozen-plus dependencies from
npm at runtime and run inside the agent's container with access to its secrets.
This one is the opposite:

- **One dependency** — the official `@modelcontextprotocol/sdk`. All HTTP uses
  Node's built-in `fetch`. No API client libs, no transitive surface.
- **One egress point** — every request goes through a single `api()` function
  that only ever calls `VIKUNJA_URL` with your token. Grep it; that's the whole
  network surface.
- **Scoped: read + additive only** — `list_projects`, `list_tasks`, `create_task`.
  No delete, no bulk, no "call arbitrary endpoint". A misbehaving/hijacked agent
  can add a task or read a list — nothing destructive.
- **Secrets from env**, never hardcoded.
- **No build step** — plain Node ESM, `node index.js`.

## Tools

| Tool | Effect | Endpoint |
| --- | --- | --- |
| `list_projects` | read | `GET /projects` |
| `list_tasks` | read | `GET /projects/{id}/tasks` |
| `create_task` | additive | `PUT /projects/{id}/tasks` |

`list_projects` and `list_tasks` support optional `page` and `per_page`.
Responses include `{ page, total_pages, count, items }`; paginate by requesting
successive pages while `page < total_pages`. Vikunja clamps `per_page` to its
configured maximum, so rely on `total_pages` rather than the returned page size.

Add tools deliberately — nothing is exposed unless you add it to the `TOOLS`
array in `index.js`.

## Config

| Env var | Example |
| --- | --- |
| `VIKUNJA_URL` | `http://192.168.100.20:3456/api/v1` (note the `/api/v1`) |
| `VIKUNJA_API_TOKEN` | `tk_...` (a Vikunja API token, scoped to Projects + Tasks) |

## Run it

```bash
git clone https://github.com/eargollo/vikunja-mcp
cd vikunja-mcp
npm install          # installs only @modelcontextprotocol/sdk
VIKUNJA_URL=http://192.168.100.20:3456/api/v1 \
VIKUNJA_API_TOKEN=tk_... \
  node index.js
```

## Register in Cursor / Claude Desktop

Add to `.mcp.json` in your project (or global MCP config):

```json
{
  "mcpServers": {
    "vikunja": {
      "command": "node",
      "args": ["/path/to/vikunja-mcp/index.js"],
      "env": {
        "VIKUNJA_URL": "http://192.168.100.20:3456/api/v1",
        "VIKUNJA_API_TOKEN": "tk_..."
      }
    }
  }
}
```

## Register in OpenClaw

Clone it into the gateway's persisted home, install, then point OpenClaw at the
local file (no npm/npx at runtime):

```bash
# inside the persisted home, e.g. /home/openclaw/.openclaw/tools/vikunja-mcp
sudo docker exec openclaw node dist/index.js mcp add vikunja \
  --command node \
  --arg /home/node/.openclaw/tools/vikunja-mcp/index.js \
  --env VIKUNJA_URL=http://192.168.100.20:3456/api/v1 \
  --env VIKUNJA_API_TOKEN=tk_...
sudo docker exec openclaw node dist/index.js mcp probe vikunja --json
```

## License

MIT

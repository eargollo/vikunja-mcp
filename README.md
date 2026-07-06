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

## Tests

Unit tests cover the pure helpers in `lib.js` (validation, query building,
pagination shaping). They need nothing but Node 20+ — no Docker, no network:

```bash
npm test               # runs test/*.test.js; e2e self-skips when no Vikunja is configured
npm run test:coverage  # same, with Node's built-in coverage report (no extra deps)
```

End-to-end tests drive the real MCP server over stdio against a live Vikunja.
Bring one up with Docker (Node 20+ also required):

```bash
npm install            # once
npm run up             # start Vikunja on http://localhost:3456 (SQLite, ephemeral)
npm run bootstrap      # register a test user, log in, write .env
npm run test:e2e       # list_projects -> create_task -> list_tasks + error paths, over MCP
npm run down           # stop and wipe (data lives in the container, so this resets)
```

`bootstrap` writes a `.env` (gitignored) with `VIKUNJA_URL` and a bearer token.
Run the server against it manually with `node --env-file=.env index.js`.

Notes:

- Storage is **ephemeral** — the SQLite DB and files live under `/tmp` inside the
  container (the image's `/app/vikunja` isn't writable by its uid-1000 user).
  `npm run down` gives you a clean slate.
- The bootstrap uses the login **session JWT** as the bearer token — Vikunja
  accepts it exactly where `index.js` sends `Bearer`, which keeps the test setup
  simple. In production, use a scoped `tk_` API token instead (see Config above).

## License

MIT

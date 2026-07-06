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
| `list_all_tasks` | read | `GET /tasks` |
| `get_task` | read | `GET /tasks/{id}` |
| `create_task` | additive | `PUT /projects/{id}/tasks` |
| `update_task` | write | `POST /tasks/{id}` |
| `set_task_done` | write | `POST /tasks/{id}` |

`list_projects`, `list_tasks`, and `list_all_tasks` support optional `page` and
`per_page`. Responses include `{ page, total_pages, count, items }`; paginate by
requesting successive pages while `page < total_pages`. Vikunja clamps `per_page`
to its configured maximum, so rely on `total_pages` rather than the returned page
size.

`list_tasks` and `list_all_tasks` also take an optional `filter` (a Vikunja
filter query like `done = false && priority >= 3`), `sort_by` (a field name), and
`order_by` (`asc`/`desc`). `get_task` returns a task's full detail (description,
dates, priority, percent_done, labels, assignees). `create_task` takes optional
`description`, `due_date`, and `priority`. `update_task` (write) changes only
the fields you pass; `set_task_done` (write) completes or reopens a task.

Add tools deliberately — the tool list lives in the `buildTools` factory in
`tools.js`, and `index.js` only exposes the tiers its env flags permit.

## Using the tools

The server speaks MCP over stdio; any MCP client (Cursor, Claude Desktop,
OpenClaw, the SDK) calls the tools by name. Arguments and results are JSON.

```jsonc
// list_projects  (no args, or { "page": 1, "per_page": 50 })
{ "page": 1, "total_pages": 1, "count": 2,
  "items": [ { "id": 1, "title": "Inbox" }, { "id": 7, "title": "Work" } ] }

// list_tasks     { "project_id": 7 }
{ "page": 1, "total_pages": 1, "count": 1,
  "items": [ { "id": 42, "title": "Ship v0.1.0", "done": false } ] }

// create_task    { "project_id": 7, "title": "Write the changelog" }
{ "id": 43, "title": "Write the changelog" }
```

List tools return a **paginated envelope** — iterate `page` while
`page < total_pages`. Invalid input (bad `project_id`, empty `title`, unknown
tool) comes back as an MCP tool error (`isError: true`) with a message, never a
crash.

## API coverage

The goal is to cover the whole Vikunja v1 API, added TDD-style (unit + e2e). To
keep the [trust posture](#why-this-exists), tools are tiered: **read** and
**additive** are always on; **write** (update) tools require
`VIKUNJA_MCP_ALLOW_WRITE=1` and **delete** tools require
`VIKUNJA_MCP_ALLOW_DELETE=1`, so a default install can never modify or destroy
data ([#4](https://github.com/eargollo/vikunja-mcp/issues/4)).

| Area | Status |
| --- | --- |
| Projects — list, create | ✅ shipped |
| Tasks — list, create | ✅ shipped |
| Task detail & filtering (`get_task`, `list_all_tasks`, filter/sort) | ✅ shipped |
| Rich task create & update (`update_task`, `set_task_done`, create fields) | ✅ shipped |
| Projects — get, update, archive, delete | 🔜 [#7](https://github.com/eargollo/vikunja-mcp/issues/7) |
| Labels | 🔜 [#8](https://github.com/eargollo/vikunja-mcp/issues/8) |
| Assignees | 🔜 [#9](https://github.com/eargollo/vikunja-mcp/issues/9) |
| Comments | 🔜 [#10](https://github.com/eargollo/vikunja-mcp/issues/10) |
| Task relations | 🔜 [#11](https://github.com/eargollo/vikunja-mcp/issues/11) |
| Attachments | 🔜 [#12](https://github.com/eargollo/vikunja-mcp/issues/12) |
| Kanban buckets | 🔜 [#13](https://github.com/eargollo/vikunja-mcp/issues/13) |
| Teams & sharing | 🔜 [#14](https://github.com/eargollo/vikunja-mcp/issues/14) |
| Saved filters | 🔜 [#15](https://github.com/eargollo/vikunja-mcp/issues/15) |
| Subscriptions & notifications | 🔜 [#16](https://github.com/eargollo/vikunja-mcp/issues/16) |
| Current user & API tokens | 🔜 [#17](https://github.com/eargollo/vikunja-mcp/issues/17) |
| Webhooks | 🔜 [#18](https://github.com/eargollo/vikunja-mcp/issues/18) |

Full roadmap: [#21](https://github.com/eargollo/vikunja-mcp/issues/21).

## Config

| Env var | Example |
| --- | --- |
| `VIKUNJA_URL` | `http://192.168.100.20:3456/api/v1` (note the `/api/v1`) |
| `VIKUNJA_API_TOKEN` | `tk_...` (a Vikunja API token, scoped to Projects + Tasks) |
| `VIKUNJA_MCP_ALLOW_WRITE` | `1` to also expose **write** (update) tools — off by default |
| `VIKUNJA_MCP_ALLOW_DELETE` | `1` to also expose **delete** (destructive) tools — off by default |

Read and additive tools are always available. Mutating and destructive tools
are registered only when the matching flag is set (`1`/`true`/`yes`/`on`), so a
default install can read and add but never modify or destroy.

## Run it

Published to npm as [`@eargollo/vikunja-mcp`](https://www.npmjs.com/package/@eargollo/vikunja-mcp)
(with build provenance). Run it straight from the registry:

```bash
VIKUNJA_URL=http://192.168.100.20:3456/api/v1 \
VIKUNJA_API_TOKEN=tk_... \
  npx @eargollo/vikunja-mcp
```

Or clone and run from source (no build step):

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

## Releasing

Releases are cut from `v*` git tags via
[`.github/workflows/release.yml`](.github/workflows/release.yml), which runs the
unit tests and publishes a GitHub Release with generated notes. The version is
bumped only at release time (`npm version`), never in feature PRs. See
[`docs/RELEASING.md`](docs/RELEASING.md).

## License

MIT

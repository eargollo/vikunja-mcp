# vikunja-mcp

A minimal, self-owned [MCP](https://modelcontextprotocol.io/) server for
[Vikunja](https://vikunja.io/), built to be small enough to read in one sitting.

## Why this exists

The available third-party Vikunja MCP servers pull a dozen-plus dependencies from
npm at runtime and run inside the agent's container with access to its secrets.
This one is the opposite:

- **One dependency** — the official `@modelcontextprotocol/sdk`. All HTTP uses
  Node's built-in `fetch`. No API client libs, no transitive surface.
- **One egress point** — every request goes through `makeApi()` in `api.js`
  that only ever calls `VIKUNJA_URL` with your token. Grep it; that's the whole
  network surface.
- **Scoped by default** — read and additive tools are always on (list, get, create
  for your token). Write tools (updates, sharing, webhooks, credential minting)
  require `VIKUNJA_MCP_ALLOW_WRITE=1`; delete tools require
  `VIKUNJA_MCP_ALLOW_DELETE=1`. A hijacked agent on a default install can add a
  task or read a list — not modify, share, bulk-replace assignees, or delete.
- **Secrets from env**, never hardcoded.
- **No build step** — plain Node ESM, `node index.js`.

## Tools

| Tool | Effect | Endpoint |
| --- | --- | --- |
| `list_projects` | read | `GET /projects` |
| `get_project` | read | `GET /projects/{id}` |
| `list_tasks` | read | `GET /projects/{id}/tasks` |
| `list_all_tasks` | read | `GET /tasks` |
| `get_task` | read | `GET /tasks/{id}` |
| `list_labels` | read | `GET /labels` |
| `search_users` | read | `GET /users?s=` |
| `list_task_assignees` | read | `GET /tasks/{id}` |
| `list_task_comments` | read | `GET /tasks/{id}/comments` |
| `list_task_relations` | read | `GET /tasks/{id}` |
| `list_task_attachments` | read | `GET /tasks/{id}/attachments` |
| `list_buckets` | read | `GET /projects/{id}/views/{view}/buckets` |
| `list_teams` | read | `GET /teams` |
| `list_saved_filters` | read | `GET /projects` (negative ids) |
| `list_notifications` | read | `GET /notifications` |
| `get_current_user` | read | `GET /user` |
| `list_api_tokens` | read | `GET /tokens` |
| `list_webhooks` | read | `GET /projects/{id}/webhooks` |
| `create_project` | additive | `PUT /projects` |
| `create_task` | additive | `PUT /projects/{id}/tasks` |
| `add_label_to_task` | additive | `PUT /tasks/{id}/labels` |
| `assign_user` | additive | `PUT /tasks/{id}/assignees` |
| `add_task_comment` | additive | `PUT /tasks/{id}/comments` |
| `create_task_relation` | additive | `PUT /tasks/{id}/relations` |
| `upload_task_attachment` | additive | `PUT /tasks/{id}/attachments` |
| `create_bucket` | additive | `PUT /projects/{id}/views/{view}/buckets` |
| `update_task` | write | `POST /tasks/{id}` |
| `create_team` | additive | `PUT /teams` |
| `share_project_with_user` | write | `PUT /projects/{id}/users` |
| `share_project_with_team` | write | `PUT /projects/{id}/teams` |
| `create_link_share` | write | `PUT /projects/{id}/shares` |
| `create_saved_filter` | additive | `PUT /filters` |
| `subscribe` | additive | `PUT /subscriptions/{entity}/{id}` |
| `create_webhook` | write | `PUT /projects/{id}/webhooks` |
| `move_task_to_bucket` | write | `POST /projects/{id}/views/{view}/buckets/{bucket_id}/tasks` |
| `update_saved_filter` | write | `POST /filters/{id}` |
| `mark_notification_read` | write | `POST /notifications/{id}` |
| `create_api_token` | write | `PUT /tokens` |
| `set_task_done` | write | `POST /tasks/{id}` |
| `delete_task` | delete | `DELETE /tasks/{id}` |
| `update_project` | write | `POST /projects/{id}` |
| `archive_project` | write | `POST /projects/{id}` |
| `create_label` | additive | `PUT /labels` |
| `delete_project` | delete | `DELETE /projects/{id}` |
| `remove_label_from_task` | delete | `DELETE /tasks/{id}/labels/{labelId}` |
| `unassign_user` | delete | `DELETE /tasks/{id}/assignees/{userId}` |
| `delete_task_comment` | delete | `DELETE /tasks/{id}/comments/{commentId}` |
| `delete_task_relation` | delete | `DELETE /tasks/{id}/relations/{kind}/{otherId}` |
| `delete_task_attachment` | delete | `DELETE /tasks/{id}/attachments/{attachmentId}` |
| `delete_saved_filter` | delete | `DELETE /filters/{id}` |
| `unsubscribe` | delete | `DELETE /subscriptions/{entity}/{id}` |
| `delete_webhook` | delete | `DELETE /projects/{id}/webhooks/{webhookId}` |

`list_projects`, `list_tasks`, and `list_all_tasks` support optional `page` and
`per_page`. Responses include `{ page, total_pages, count, items }`; paginate by
requesting successive pages while `page < total_pages`. Vikunja clamps `per_page`
to its configured maximum, so rely on `total_pages` rather than the returned page
size.

`list_tasks` and `list_all_tasks` also take an optional `filter` (a Vikunja
filter query — combine predicates with `&&` / `||`, compare with `=`, `!=`,
`<`, `>`, `<=`, `>=`; filter fields are not the same as `sort_by` fields),
`sort_by` (a bare Vikunja field name; direction goes in `order`, not here), and
`order` (`asc`/`desc`). `get_task` returns a task's full detail (description,
dates, priority, percent_done, labels, assignees). `create_task` takes optional
`description`, `due_date` (ISO 8601 required), and `priority`. `update_task`
(write) changes only the fields you pass; `set_task_done` (write) completes or
reopens a task; `delete_task` (delete) removes a task permanently.

Add tools deliberately — the tool list lives in the `buildTools` factory in
`tools.js`, and `index.js` only exposes the tiers its env flags permit. Each tool
also exposes an MCP **title** for display in clients (e.g. `list_projects` →
"List Projects").

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
{ "id": 43, "title": "Write the changelog", "done": false, "project_id": 7, ... }

// assign_user    { "task_id": 42, "user_id": 3 }
{ "ok": true, "task_id": 42, "user_id": 3 }
```

List tools return `{ count, items }` (plus pagination or context fields).
`list_task_relations` is the exception: it returns a keyed `relations` map.
Mutations return either the entity detail (`create_task` → same shape as
`get_task`) or `{ ok: true, ...ids }` for deletes and association changes.
Inputs use `*_id`; list/detail outputs use `id`.

Invalid input (bad `project_id`, empty `title`, unknown tool) comes back as an MCP tool error (`isError: true`) with a message, never a crash.

## API coverage

The goal is to cover the **most common** Vikunja v1 operations agents need,
added TDD-style (unit + e2e). This is not a complete mirror of every endpoint
(CalDAV sync itself uses `/dav`, not these tools). To keep the
[trust posture](#why-this-exists), tools are tiered: **read** and **additive**
are always on; **write** (update, sharing, egress, credential minting, bulk
replace) tools require `VIKUNJA_MCP_ALLOW_WRITE=1` and **delete** tools require
`VIKUNJA_MCP_ALLOW_DELETE=1`, so a default install can never modify or destroy
data ([#4](https://github.com/eargollo/vikunja-mcp/issues/4)).

| Area | Status |
| --- | --- |
| Projects — list, get, create, update, archive, delete | ✅ shipped |
| Tasks — list, get, create, update, delete, bulk update | ✅ shipped |
| Task detail & filtering (`get_task`, `list_all_tasks`, filter/sort) | ✅ shipped |
| Rich task create & update (`update_task`, `set_task_done`, create fields) | ✅ shipped |
| Labels — list/create/update/delete; add/remove on tasks; bulk replace on task | ✅ shipped |
| Assignees (`search_users`, list/assign/unassign; bulk replace on task) | ✅ shipped |
| Task comments (list/add/update/delete) | ✅ shipped |
| Task relations (list/create/delete) | ✅ shipped |
| Attachments (list/upload/delete, base64 upload) | ✅ shipped |
| Kanban buckets (list/create/update/delete, move task) | ✅ shipped |
| Teams — list/create/get/update; members add/remove/admin toggle | ✅ shipped |
| Project sharing (user/team/link shares) | ✅ shipped |
| Saved filters (list/create/update/delete) | ✅ shipped |
| Subscriptions & notifications (list/mark-read, subscribe/unsubscribe) | ✅ shipped |
| Current user, API tokens, CalDAV tokens & connection info | ✅ shipped |
| Webhooks (list/create/update/delete) | ✅ shipped |

Partial / intentional gaps: no arbitrary `/routes` proxy, no admin endpoints, no
user-level webhooks, no `outputSchema` on tool results (JSON text is enough for
now). See [CHANGELOG.md](CHANGELOG.md) for recent additions.

Full roadmap: [#21](https://github.com/eargollo/vikunja-mcp/issues/21).

## Config

| Env var | Example |
| --- | --- |
| `VIKUNJA_URL` | `https://app.vikunja.cloud/api/v1` (note the `/api/v1`) |
| `VIKUNJA_API_TOKEN` | `tk_...` (a Vikunja API token, scoped to Projects + Tasks) |
| `VIKUNJA_MCP_ALLOW_WRITE` | `1` to also expose **write** tools (updates, sharing, webhooks, API tokens) — off by default |
| `VIKUNJA_MCP_ALLOW_DELETE` | `1` to also expose **delete** (destructive) tools — off by default |

Read and additive tools are always available. Mutating and destructive tools
are registered only when the matching flag is set (`1`/`true`/`yes`/`on`), so a
default install can read and add but never modify or destroy. The server advertises
its posture via MCP `instructions` and per-tool `annotations` (`readOnlyHint`,
`destructiveHint`) so hosts can auto-approve reads and confirm deletes.

`subscribe` / `unsubscribe` take `entity` (`project` or `task`) and `entity_id`.

## Run it

Published to npm as [`@eargollo/vikunja-mcp`](https://www.npmjs.com/package/@eargollo/vikunja-mcp)
(with build provenance). Run it straight from the registry:

```bash
VIKUNJA_URL=https://app.vikunja.cloud/api/v1 \
VIKUNJA_API_TOKEN=tk_... \
  npx @eargollo/vikunja-mcp
```

Or clone and run from source (no build step):

```bash
git clone https://github.com/eargollo/vikunja-mcp
cd vikunja-mcp
npm install          # installs only @modelcontextprotocol/sdk
VIKUNJA_URL=https://app.vikunja.cloud/api/v1 \
VIKUNJA_API_TOKEN=tk_... \
  node index.js
```

## Register in Cursor / Claude Desktop

Add to `.mcp.json` in your project (or global MCP config). Running from the
registry with `npx` needs no clone and no local `node_modules`:

```json
{
  "mcpServers": {
    "vikunja": {
      "command": "npx",
      "args": ["-y", "@eargollo/vikunja-mcp@latest"],
      "env": {
        "VIKUNJA_URL": "https://app.vikunja.cloud/api/v1",
        "VIKUNJA_API_TOKEN": "tk_..."
      }
    }
  }
}
```

Pin a version with `@eargollo/vikunja-mcp@<version>` if you'd rather not float on
the latest. To run from a clone instead, use `"command": "node"` with
`"args": ["/path/to/vikunja-mcp/index.js"]` — but `npm install` must have been
run in that directory so `node_modules` sits next to `index.js`.

## Register in an MCP gateway (OpenClaw, etc.)

For a gateway that launches MCP servers as local processes, run the published
package with `npx` — the gateway fetches it from the registry each time it
starts the server, so there's no repo to clone and no `node_modules` to keep in
sync next to `index.js`. The exact command depends on your gateway; the shape is:

```bash
<gateway-cli> mcp add vikunja \
  --command npx \
  --arg -y --arg @eargollo/vikunja-mcp@latest \
  --env VIKUNJA_URL=https://app.vikunja.cloud/api/v1 \
  --env VIKUNJA_API_TOKEN=tk_...
```

`@latest` tracks the newest release (pulled on server restart); pin an exact
version with `@eargollo/vikunja-mcp@<version>`. Requires npm/network access.

If the gateway is air-gapped, clone the repo into its persisted storage, run
`npm install` there, and point at the file instead — but `node_modules` **must**
live next to `index.js`, or the process exits on startup:

```bash
<gateway-cli> mcp add vikunja \
  --command node \
  --arg /path/to/vikunja-mcp/index.js \
  --env VIKUNJA_URL=https://app.vikunja.cloud/api/v1 \
  --env VIKUNJA_API_TOKEN=tk_...
```

## Tests

Unit tests cover the pure helpers in `lib.js` (validation, query building,
pagination shaping). They need nothing but Node 20+ — no Docker, no network:

```bash
npm test               # runs test/*.test.js; e2e self-skips when no Vikunja is configured
npm run test:coverage  # same, with Node's built-in coverage report (no extra deps)
```

End-to-end tests drive the real MCP server over stdio against a live Vikunja.
The compose file pins **Vikunja `2.3.0`** (bump deliberately, not `:latest`, so
upstream releases can't break CI silently). Bring one up with Docker (Node 20+
also required):

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

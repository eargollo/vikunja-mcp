# vikunja-mcp

[![npm](https://img.shields.io/npm/v/@eargollo/vikunja-mcp)](https://www.npmjs.com/package/@eargollo/vikunja-mcp)
[![CI](https://github.com/eargollo/vikunja-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/eargollo/vikunja-mcp/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/badge/coverage-100%25_lines_%7C_90%25%2B_branches-brightgreen)](https://github.com/eargollo/vikunja-mcp/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@eargollo/vikunja-mcp)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@eargollo/vikunja-mcp)](LICENSE)

A minimal, self-owned [MCP](https://modelcontextprotocol.io/) server for
[Vikunja](https://vikunja.io/), built to be small enough to read in one sitting.

## Why this exists

The available third-party Vikunja MCP servers pull a dozen-plus dependencies from
npm at runtime and run inside the agent's container with access to its secrets.
This one is the opposite:

- **One direct dependency** — the official `@modelcontextprotocol/sdk`. All HTTP
  uses Node's built-in `fetch`; this project adds no API-client libs of its own.
  The only transitive dependencies are the SDK's, and the stdio transport used
  here never loads its HTTP/OAuth stack.
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

## Quickstart

**Requirements:** Node ≥ 20 and a Vikunja instance (tested against Vikunja
`2.3.0`, API v1). No build step, no Docker for normal use.

Run it straight from npm:

```bash
VIKUNJA_URL=https://app.vikunja.cloud/api/v1 \
VIKUNJA_API_TOKEN=tk_... \
  npx @eargollo/vikunja-mcp
```

Or wire it into an MCP client's config:

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

That exposes the read + additive tools. To turn on write or delete tools see
[Config](#config); for running from source or an air-gapped gateway see
[Running](#running).

## Tools

Grouped by permission tier (read + additive are always on; write and delete are
opt-in — see [Config](#config)):

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
| `get_team` | read | `GET /teams/{id}` |
| `list_saved_filters` | read | `GET /projects` (negative ids) |
| `list_notifications` | read | `GET /notifications` |
| `get_current_user` | read | `GET /user` |
| `list_api_tokens` | read | `GET /tokens` |
| `list_webhooks` | read | `GET /projects/{id}/webhooks` |
| `get_caldav_info` | read | `GET /user` (+ CalDAV connection info) |
| `create_project` | additive | `PUT /projects` |
| `create_task` | additive | `PUT /projects/{id}/tasks` |
| `add_label_to_task` | additive | `PUT /tasks/{id}/labels` |
| `assign_user` | additive | `PUT /tasks/{id}/assignees` |
| `add_task_comment` | additive | `PUT /tasks/{id}/comments` |
| `create_task_relation` | additive | `PUT /tasks/{id}/relations` |
| `upload_task_attachment` | additive | `PUT /tasks/{id}/attachments` |
| `create_bucket` | additive | `PUT /projects/{id}/views/{view}/buckets` |
| `create_team` | additive | `PUT /teams` |
| `add_team_member` | additive | `PUT /teams/{id}/members` |
| `create_label` | additive | `PUT /labels` |
| `create_saved_filter` | additive | `PUT /filters` |
| `subscribe` | additive | `PUT /subscriptions/{entity}/{id}` |
| `update_task` | write | `POST /tasks/{id}` |
| `set_task_done` | write | `POST /tasks/{id}` |
| `bulk_update_tasks` | write | `POST /tasks/bulk` |
| `set_task_labels` | write | `POST /tasks/{id}/labels/bulk` |
| `set_task_assignees` | write | `POST /tasks/{id}/assignees/bulk` |
| `update_project` | write | `POST /projects/{id}` |
| `archive_project` | write | `POST /projects/{id}` |
| `update_task_comment` | write | `POST /tasks/{id}/comments/{commentId}` |
| `update_label` | write | `POST /labels/{id}` |
| `update_bucket` | write | `POST /projects/{id}/views/{view}/buckets/{bucketId}` |
| `move_task_to_bucket` | write | `POST /projects/{id}/views/{view}/buckets/{bucket_id}/tasks` |
| `update_team` | write | `POST /teams/{id}` |
| `toggle_team_member_admin` | write | `POST /teams/{id}/members/{userId}/admin` |
| `share_project_with_user` | write | `PUT /projects/{id}/users` |
| `share_project_with_team` | write | `PUT /projects/{id}/teams` |
| `create_link_share` | write | `PUT /projects/{id}/shares` |
| `create_webhook` | write | `PUT /projects/{id}/webhooks` |
| `update_webhook` | write | `POST /projects/{id}/webhooks/{webhookId}` |
| `update_saved_filter` | write | `POST /filters/{id}` |
| `mark_notification_read` | write | `POST /notifications/{id}` |
| `create_api_token` | write | `PUT /tokens` |
| `create_caldav_token` | write | `PUT /user/settings/token/caldav` |
| `delete_task` | delete | `DELETE /tasks/{id}` |
| `delete_project` | delete | `DELETE /projects/{id}` |
| `remove_label_from_task` | delete | `DELETE /tasks/{id}/labels/{labelId}` |
| `unassign_user` | delete | `DELETE /tasks/{id}/assignees/{userId}` |
| `delete_task_comment` | delete | `DELETE /tasks/{id}/comments/{commentId}` |
| `delete_task_relation` | delete | `DELETE /tasks/{id}/relations/{kind}/{otherId}` |
| `delete_task_attachment` | delete | `DELETE /tasks/{id}/attachments/{attachmentId}` |
| `delete_label` | delete | `DELETE /labels/{id}` |
| `delete_bucket` | delete | `DELETE /projects/{id}/views/{view}/buckets/{bucketId}` |
| `remove_team_member` | delete | `DELETE /teams/{id}/members/{userId}` |
| `delete_saved_filter` | delete | `DELETE /filters/{id}` |
| `unsubscribe` | delete | `DELETE /subscriptions/{entity}/{id}` |
| `delete_webhook` | delete | `DELETE /projects/{id}/webhooks/{webhookId}` |
| `delete_caldav_token` | delete | `DELETE /user/settings/token/caldav/{id}` |

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

## Scope & gaps

The goal is **full coverage of the Vikunja v1 API**, every tool added TDD-style
(unit + e2e). The handful of surfaces left out are excluded because they **don't
make sense as agent tools** or would undercut the security posture — not for lack
of reach (see below). The [Tools](#tools) table above is the authoritative,
per-tool coverage list; by area that spans Projects ·
Tasks (detail, filter/sort, bulk) · Labels · Assignees · Task comments · Task
relations · Attachments (base64) · Kanban buckets · Teams & members · Project
sharing (user/team/link) · Saved filters · Subscriptions & notifications · Current
user, API tokens & CalDAV · Webhooks.

**Out of scope, by design:** CalDAV *sync* (that's the `/dav` WebDAV protocol, not a
REST call an agent makes), an arbitrary `/routes` proxy (a generic passthrough would
defeat the point of scoped, validated tools), server **admin** endpoints (privileged
operations an agent has no business running), and **user-level** webhooks (project
webhooks only, to keep the surface narrow). Tool results carry MCP `structuredContent`,
but no declared `outputSchema` yet.

See [CHANGELOG.md](CHANGELOG.md) for recent additions and
[#21](https://github.com/eargollo/vikunja-mcp/issues/21) for the roadmap.

## Config

| Env var | Example |
| --- | --- |
| `VIKUNJA_URL` | `https://app.vikunja.cloud/api/v1` (note the `/api/v1`) |
| `VIKUNJA_API_TOKEN` | `tk_...` (a Vikunja API token; scope it to the areas whose tools you enable — Projects + Tasks covers the default read/additive set, but Teams, Labels, Webhooks, Filters, Subscriptions, Tokens and CalDAV each need their own scope) |
| `VIKUNJA_MCP_ALLOW_WRITE` | `1` to also expose **write** tools (updates, sharing, webhooks, API tokens) — off by default |
| `VIKUNJA_MCP_ALLOW_DELETE` | `1` to also expose **delete** (destructive) tools — off by default |

Read and additive tools are always available. Mutating and destructive tools
are registered only when the matching flag is set (`1`/`true`/`yes`/`on`), so a
default install can read and add but never modify or destroy. The server advertises
its posture via MCP `instructions` and per-tool `annotations` (`readOnlyHint`,
`destructiveHint`) so hosts can auto-approve reads and confirm deletes.

`subscribe` / `unsubscribe` take `entity` (`project` or `task`) and `entity_id`.

## Running

Two run modes, referenced by every integration below. Published to npm as
[`@eargollo/vikunja-mcp`](https://www.npmjs.com/package/@eargollo/vikunja-mcp)
(with build provenance).

- **From npm (recommended)** — `npx @eargollo/vikunja-mcp` fetches the package
  from the registry on each start; no clone, no `node_modules` to manage.
  `@latest` tracks the newest release, or pin an exact version with
  `@eargollo/vikunja-mcp@<version>`. Requires npm/network access.
- **From source** — clone, `npm install` once (installs only the SDK), then
  `node index.js`. No build step. The one rule: `node_modules` **must** sit next
  to `index.js`, or the process exits on startup. This is the air-gapped path.

```bash
# from npm
VIKUNJA_URL=https://app.vikunja.cloud/api/v1 \
VIKUNJA_API_TOKEN=tk_... \
  npx @eargollo/vikunja-mcp

# from source
git clone https://github.com/eargollo/vikunja-mcp
cd vikunja-mcp && npm install
VIKUNJA_URL=https://app.vikunja.cloud/api/v1 \
VIKUNJA_API_TOKEN=tk_... \
  node index.js
```

### Register in Cursor / Claude Desktop

Add the [Quickstart](#quickstart) `.mcp.json` block to your project (or your
client's global MCP config); the npm form needs no clone. To run from source
instead, use `"command": "node"` with `"args": ["/path/to/vikunja-mcp/index.js"]`
— remember `node_modules` must sit next to `index.js` (see [Running](#running)).

### Register in OpenClaw

OpenClaw runs MCP servers as local processes inside its container, so register
vikunja with `mcp add` and verify with `mcp probe`. Air-gapped setups run **from
source** — clone into the gateway's persisted home (so it survives restarts) and
point at `index.js` (`node_modules` must sit next to it):

```bash
# from source (no npm/npx needed at runtime)
sudo docker exec openclaw node dist/index.js mcp add vikunja \
  --command node \
  --arg /path/to/vikunja-mcp/index.js \
  --env VIKUNJA_URL=https://app.vikunja.cloud/api/v1 \
  --env VIKUNJA_API_TOKEN=tk_...

# or, if the gateway has network access, straight from npm
sudo docker exec openclaw node dist/index.js mcp add vikunja \
  --command npx \
  --arg -y --arg @eargollo/vikunja-mcp@latest \
  --env VIKUNJA_URL=https://app.vikunja.cloud/api/v1 \
  --env VIKUNJA_API_TOKEN=tk_...

# verify the tools are exposed
sudo docker exec openclaw node dist/index.js mcp probe vikunja --json
```

Replace `openclaw` with your container name. Other MCP gateways use a different
CLI but the same shape: a command (`node` or `npx`), args, and the two env vars.

## Tests

Unit tests cover the pure helpers in `lib.js` (validation, query building,
pagination shaping) and every tool handler in `tools.js` with an injected
`api()` — happy paths, input validation, and the empty/malformed-response
guards — so no server or network is needed. They run on Node 20+ alone:

```bash
npm test               # runs test/*.test.js; e2e self-skips when no Vikunja is configured
npm run test:coverage  # same, with Node's built-in coverage report (no extra deps)
```

`test:coverage` is what CI runs, and it fails the build if coverage falls below
100% lines / 90% branches / 100% functions — the guarantee the coverage badge
above reflects. No coverage service or extra dependency is involved.

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
unit tests, publishes the package to npm via OIDC Trusted Publishing (no stored
token, build provenance attached), and creates a GitHub Release with generated
notes. The version is bumped only at release time (`npm version`), never in
feature PRs. See [`docs/RELEASING.md`](docs/RELEASING.md).

## Security

The whole design goal here is a small, auditable trust surface (one egress point,
opt-in write/delete, secrets from env). If you find a vulnerability, please report
it privately — see [SECURITY.md](SECURITY.md) for the disclosure path.

## License

MIT

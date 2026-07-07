# Changelog

All notable changes to this project are documented here. Version bumps happen at
release tags only (see [docs/RELEASING.md](docs/RELEASING.md)).

## Unreleased

### Fixed / hardened

- `list_saved_filters` now pages through the entire projects list (saved filters
  are negative-id pseudo-projects) so none are missed on large instances —
  replacing the earlier single-page read.
- `toolDisplayTitle` drops empty segments, so unusual names can't produce
  edge/doubled spaces.
- `toggle_team_member_admin` description points to `get_team` for the resulting
  state (the endpoint returns no member object).

### CI / tooling

- Coverage is now **gated** in CI (lines/branches/functions thresholds via
  `test:coverage`) instead of merely printed, so coverage can't silently regress.
- Added the previously-missing unit tests: `decodeBase64` encoded-length
  short-circuit and `toolDisplayTitle` edge cases.

## 1.0.0 - 2026-07-07

First stable release. The tool names, input schemas, and output shapes are now a
contract covered by semver — breaking changes will bump the major version.

### Added

- **API coverage (post-1.0):** `update_label`, `delete_label`, `update_bucket`,
  `delete_bucket`, `update_webhook`, `update_task_comment`, `get_team`,
  `update_team`, `add_team_member`, `remove_team_member`,
  `toggle_team_member_admin`, `bulk_update_tasks`, `set_task_labels`,
  `set_task_assignees`, `get_caldav_info`, `create_caldav_token`,
  `delete_caldav_token`.
- MCP **tool display titles** (`list_projects` → "List Projects") on
  `tools/list`.

### Changed

- README honesty pass: default install is read + additive, but write/delete
  tiers exist when opted in; coverage goal softened to “most common operations”;
  Labels and Teams marked partial where applicable.

### Fixed / hardened (pre-1.0)

- `api()`: a timeout that fires *during the response-body read* is now wrapped as
  a clean "request timed out" error instead of leaking a raw `AbortError`.
- `api()`: CalDAV-token creation (`PUT /user/settings/token/caldav`) is now
  treated as a secret-bearing path, so its error bodies are omitted from logs
  (matching API tokens and shares).
- `api()`: response-body cap raised 1 MiB → 25 MiB so large-but-legitimate
  responses (e.g. the unpaginated `GET /projects` behind `list_saved_filters`)
  no longer false-positive, while still bounding memory.
- Delete tools now advertise `idempotentHint: true` (re-deleting is safe to
  retry); `priority` schema fields are `integer` (matching runtime validation).
- `bulk_update_tasks`: the "no fields to update" guard no longer depends on a
  positional body assumption.
- More unit coverage: body-read timeout, size-cap surfacing, CalDAV sensitive
  path, `requireNodeMinVersion`, and clean titles for every shipped tool.

### Not in this release (deferred)

- `outputSchema` / `structuredContent` for tool results (JSON-as-text is enough
  for 1.0; paginated lists are the best post-1.0 candidate).
- Splitting `tools.js` into per-domain modules (judgment call if the file keeps
  growing).

## 0.16.1 and earlier

See [GitHub Releases](https://github.com/eargollo/vikunja-mcp/releases).

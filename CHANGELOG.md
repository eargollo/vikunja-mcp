# Changelog

All notable changes to this project are documented here. Version bumps happen at
release tags only (see [docs/RELEASING.md](docs/RELEASING.md)).

## Unreleased

### Fixed

- `bulk_update_tasks` now actually applies the update. Vikunja's
  `POST /tasks/bulk` expects `{ task_ids, fields, values }` — `values` is a task
  object and `fields` names which of its columns to write — but the tool sent the
  changed fields flat (`{ task_ids, done, ... }`). Vikunja accepts that body with
  HTTP 200 yet updates nothing, so the tool reported `{ ok: true }` while silently
  doing nothing on every call. It now builds the `fields`/`values` pair, and a new
  end-to-end test confirms the change persists across multiple tasks.

## 1.2.0 - 2026-07-20

### Fixed

- `update_task` and `set_task_done` no longer wipe fields they don't touch.
  `POST /tasks/{id}` is a full-model replace — Vikunja resets any field the body
  omits to its zero value — so a partial update (e.g. changing only `priority`)
  silently cleared the task's `due_date`, `description`, dates, etc. Both tools
  now fetch the current task and send it back whole, overriding only the
  caller-supplied fields (same read-modify-write pattern already used by
  `update_project` / `update_saved_filter`).
- `remove_team_member` and `toggle_team_member_admin` now take a `username`
  instead of a numeric `user_id`. Both routes are keyed on the username
  (`/teams/{id}/members/{username}` and `/teams/{id}/members/{username}/admin`),
  which Vikunja resolves via `GetUserByUsername`; passing a numeric id was looked
  up as a literal username and 404'd for any non-numeric account. The
  `type: integer` in the OpenAPI spec for these path params is a copy-paste
  artifact.
- `share_project_with_user` now takes a `username` instead of a numeric
  `user_id`. `ProjectUser.UserID` is `json:"-"` (never read from the body) and
  Vikunja resolves the grantee via `GetUserByUsername`, so the previous
  `user_id` body was ignored and every share attempt failed with a 404 "user
  does not exist". The tool was effectively non-functional.
- `update_label` no longer wipes a label's description. `Label.Update` writes
  `title`/`description`/`hex_color` unconditionally, but the read-modify-write
  merge only carried `title`/`hex_color`, so editing a label's title cleared a
  description set elsewhere. The description is now preserved.

### CI / tooling

- Bumped pinned GitHub Actions: `actions/setup-node` v7, `softprops/action-gh-release`
  v3.0.2, and `trufflesecurity/trufflehog` v3.95.9 (Dependabot, SHA-pinned).

## 1.1.2 - 2026-07-11

### CI / tooling

- Added continuous supply-chain security: CI now gates on `npm audit --omit=dev
  --audit-level=high` and an `actions/dependency-review-action` check on PRs, so
  a newly-disclosed CVE in the dependency tree fails the build instead of
  shipping silently.
- Added `.github/dependabot.yml` for the `npm` and `github-actions` ecosystems
  (weekly bumps, grouped; security updates open on their own).
- Pinned all GitHub Actions to full commit SHAs (with version comments) instead
  of floating `@v4`/`@v2` tags, closing the mutable-tag risk on the publish
  pipeline. Dependabot keeps the SHAs current.
- Added **CodeQL** static analysis (`.github/workflows/codeql.yml`) on push, PR,
  and a weekly schedule, with the `security-and-quality` query suite.
- `ci.yml` now declares least-privilege `permissions: contents: read`.
- Added `.npmrc` with `ignore-scripts=true` so dependency install/lifecycle
  scripts never run (belt-and-suspenders; the tree has none today).
- Added an ESLint (`eslint-plugin-security`) CI gate. eslint and the plugin are
  **not** project dependencies — the lint job installs them ephemerally at
  pinned versions (`--no-save`), so the runtime tree stays at one dependency and
  the published package is unchanged. Config lives in `eslint.config.js`.
- Added a **TruffleHog** secret-scan job (PR-only, `--only-verified`) that
  *validates* findings against provider APIs, adding a live-credential check on
  top of GitHub's native secret scanning + push protection.
- Bumped the pinned GitHub Actions to current majors: `actions/checkout` v7,
  `actions/dependency-review-action` v5, `softprops/action-gh-release` v3, and
  `github/codeql-action` (init + analyze, kept in lockstep) v4.37.0.
- Release workflow now runs on **Node 24** (was Node 20): `npm@latest` is 12.x and
  refuses to install on Node 20, which broke the OIDC publish step.

### Docs

- Restored concrete **OpenClaw** registration steps (the `mcp add` / `mcp probe`
  commands, source + npm modes), which the earlier gateway-generalization pass
  had reduced to a `<gateway-cli>` placeholder — using neutral placeholders, no
  private host/paths.
- Reframed the npm description and README **Scope & gaps** as *security-first,
  full API coverage*: the description now leads with the differentiators
  (security-first, full API coverage, read-only by default with opt-in
  write/delete, and one dependency — the official MCP SDK), and the Scope section
  lists the deliberately out-of-scope surfaces (CalDAV sync, `/routes` proxy,
  admin endpoints, user-level webhooks) with the reason for each. Added a
  coverage badge.

### Tests

- Added `test/tools-guards.test.js` — negative-path coverage for every tool's
  error guards (empty/malformed Vikunja responses and pre-network input
  validation), plus the `File`-API and `requireUsername` guards in `lib.js`.
  Raised the CI-enforced coverage gate to **100% lines / 90% branches / 100%
  functions** (up from 88 / 80 / 85); `tools.js` reached 100% line and 83% branch
  coverage.

## 1.1.1 - 2026-07-07

### Docs

- README Tools table now lists **all** shipped tools (the team, CalDAV, bulk, and
  update/delete tools added in 1.0.0 were missing) and is grouped by permission
  tier.
- Dropped the inaccurate "no transitive surface" claim: this project adds one
  direct dependency, but the SDK has its own transitive deps (the stdio transport
  never loads its HTTP/OAuth stack).
- `docs/RELEASING.md` rewritten for the post-1.0, npm-published reality:
  contract-breaking changes are a major bump, and distribution is npm via OIDC
  Trusted Publishing (not "GitHub-only"). README's release note mentions the npm
  publish + provenance step. Token-scope guidance in Config broadened beyond
  Projects + Tasks.
- README now leads with a **Quickstart** (requirements + npx run + `.mcp.json`),
  carries npm/CI/node/license badges, and consolidates the repeated npx-vs-source
  and gateway instructions into one **Running** section.
- Added `SECURITY.md` with a private vulnerability-disclosure path, linked from a
  new README **Security** section.

### Tests

- Added a **README drift guard** (`test/docs.test.js`) that fails if the Tools
  table and `buildTools()` disagree, so the table can't silently fall behind.

## 1.1.0 - 2026-07-07

### Added

- Tool results now include MCP `structuredContent` (the raw result object)
  alongside the text block, so clients can consume typed output without
  re-parsing.

### Fixed / hardened

- `api()` surfaces `401`/`403` as a clear "authentication failed — check
  VIKUNJA_API_TOKEN" error instead of a generic 4xx.

### Tests

- e2e now asserts `tools/list` emits titles + tier-derived annotations, and that
  `structuredContent` mirrors the text payload.
- Unit tests added for the 14 handlers that were previously e2e-only, bringing
  `tools.js` to 100% function coverage (exact method/path/body, fetch-merge
  no-clobber, validate-before-network).

## 1.0.1 - 2026-07-07

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

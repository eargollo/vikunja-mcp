# Changelog

All notable changes to this project are documented here. Version bumps happen at
release tags only (see [docs/RELEASING.md](docs/RELEASING.md)).

## Unreleased

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

### Not in this release (deferred)

- `outputSchema` / `structuredContent` for tool results (JSON-as-text is enough
  for 1.0; paginated lists are the best post-1.0 candidate).
- Splitting `tools.js` into per-domain modules (judgment call if the file keeps
  growing).

## 0.16.1 and earlier

See [GitHub Releases](https://github.com/eargollo/vikunja-mcp/releases).

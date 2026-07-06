// Tool definitions for vikunja-mcp.
//
// Kept out of index.js (which owns the single network egress and the server
// wiring) so the handlers can be unit-tested with an injected fake api() — no
// server, no network. buildTools({ api }) returns the tool list; each tool
// carries a `tier` so index.js can gate write/delete behind opt-in env flags.

import {
  requireProjectId,
  requireTitle,
  optionalPage,
  optionalPerPage,
  buildQuery,
  paginatedResult,
} from "./lib.js";

const paginationSchema = {
  page: { type: "number", description: "Page number (default: 1)" },
  per_page: {
    type: "number",
    description: "Items per page, 1-100 (Vikunja default if omitted)",
  },
};

// Read + additive only. Add tools here deliberately; give each a `tier` so the
// gating in index.js can keep write/delete off by default.
export function buildTools({ api }) {
  return [
    {
      name: "list_projects",
      tier: "read",
      description:
        "List Vikunja projects the token can see (id + title). Results are paginated; pass page/per_page and request successive pages while page < total_pages.",
      inputSchema: {
        type: "object",
        properties: paginationSchema,
        additionalProperties: false,
      },
      run: async ({ page, per_page } = {}) => {
        const resolvedPage = optionalPage(page);
        const resolvedPerPage = optionalPerPage(per_page);
        const query = buildQuery({ page: resolvedPage, per_page: resolvedPerPage });
        const { data, headers } = await api("GET", `/projects${query}`);
        const items = (data ?? []).map((p) => ({ id: p.id, title: p.title }));
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "list_tasks",
      tier: "read",
      description:
        "List tasks in a project by project id (id, title, done). Results are paginated; pass page/per_page and request successive pages while page < total_pages.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          ...paginationSchema,
        },
        required: ["project_id"],
        additionalProperties: false,
      },
      run: async ({ project_id, page, per_page }) => {
        const id = requireProjectId(project_id);
        const resolvedPage = optionalPage(page);
        const resolvedPerPage = optionalPerPage(per_page);
        const query = buildQuery({ page: resolvedPage, per_page: resolvedPerPage });
        const { data, headers } = await api("GET", `/projects/${id}/tasks${query}`);
        const items = (data ?? []).map((t) => ({ id: t.id, title: t.title, done: t.done }));
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "create_task",
      tier: "additive",
      description: "Create a task with a title in a project (additive only).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          title: { type: "string", description: "Task title" },
        },
        required: ["project_id", "title"],
        additionalProperties: false,
      },
      run: async ({ project_id, title }) => {
        const id = requireProjectId(project_id);
        const taskTitle = requireTitle(title);
        const { data: task } = await api("PUT", `/projects/${id}/tasks`, { title: taskTitle });
        if (!task || task.id == null) {
          throw new Error("Vikunja returned an empty task response");
        }
        return { id: task.id, title: task.title };
      },
    },
  ];
}

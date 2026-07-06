// Tool definitions for vikunja-mcp.
//
// Kept out of index.js (which owns the single network egress and the server
// wiring) so the handlers can be unit-tested with an injected fake api() — no
// server, no network. buildTools({ api }) returns the tool list; each tool
// carries a `tier` so index.js can gate write/delete behind opt-in env flags.

import {
  requireProjectId,
  requireTaskId,
  requireTitle,
  optionalPage,
  optionalPerPage,
  optionalFilter,
  optionalSortBy,
  optionalOrder,
  buildQuery,
  paginatedResult,
  taskDetail,
} from "./lib.js";

const paginationSchema = {
  page: { type: "number", description: "Page number (default: 1)" },
  per_page: {
    type: "number",
    description: "Items per page, 1-100 (Vikunja default if omitted)",
  },
};

const filterSortSchema = {
  filter: {
    type: "string",
    description: 'Vikunja filter query, e.g. "done = false && priority >= 3".',
  },
  sort_by: { type: "string", description: "Field to sort by, e.g. due_date, priority." },
  order_by: { type: "string", description: "Sort direction.", enum: ["asc", "desc"] },
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
        "List tasks in a project by project id (id, title, done). Optional filter/sort_by/order_by. Results are paginated; pass page/per_page and request successive pages while page < total_pages.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          ...filterSortSchema,
          ...paginationSchema,
        },
        required: ["project_id"],
        additionalProperties: false,
      },
      run: async ({ project_id, filter, sort_by, order_by, page, per_page }) => {
        const id = requireProjectId(project_id);
        const resolvedPage = optionalPage(page);
        const resolvedPerPage = optionalPerPage(per_page);
        const query = buildQuery({
          filter: optionalFilter(filter),
          sort_by: optionalSortBy(sort_by),
          order_by: optionalOrder(order_by),
          page: resolvedPage,
          per_page: resolvedPerPage,
        });
        const { data, headers } = await api("GET", `/projects/${id}/tasks${query}`);
        const items = (data ?? []).map((t) => ({ id: t.id, title: t.title, done: t.done }));
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "list_all_tasks",
      tier: "read",
      description:
        "List tasks across all projects the token can see (id, title, done, project_id). Optional filter/sort_by/order_by. Paginated; request successive pages while page < total_pages.",
      inputSchema: {
        type: "object",
        properties: { ...filterSortSchema, ...paginationSchema },
        additionalProperties: false,
      },
      run: async ({ filter, sort_by, order_by, page, per_page } = {}) => {
        const resolvedPage = optionalPage(page);
        const resolvedPerPage = optionalPerPage(per_page);
        const query = buildQuery({
          filter: optionalFilter(filter),
          sort_by: optionalSortBy(sort_by),
          order_by: optionalOrder(order_by),
          page: resolvedPage,
          per_page: resolvedPerPage,
        });
        const { data, headers } = await api("GET", `/tasks${query}`);
        const items = (data ?? []).map((t) => ({
          id: t.id,
          title: t.title,
          done: t.done,
          project_id: t.project_id,
        }));
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "get_task",
      tier: "read",
      description:
        "Get one task by id with its fields (description, done, dates, priority, percent_done, labels, assignees).",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "number", description: "Vikunja task id" } },
        required: ["task_id"],
        additionalProperties: false,
      },
      run: async ({ task_id }) => {
        const id = requireTaskId(task_id);
        const { data } = await api("GET", `/tasks/${id}`);
        if (!data || data.id == null) {
          throw new Error("Vikunja returned no task");
        }
        return taskDetail(data);
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

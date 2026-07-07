// Tool definitions for vikunja-mcp.
//
// Kept out of index.js (which owns the single network egress and the server
// wiring) so the handlers can be unit-tested with an injected fake api() — no
// server, no network. buildTools({ api }) returns the tool list; each tool
// carries a `tier` so index.js can gate write/delete behind opt-in env flags.

import {
  requireProjectId,
  requireTaskId,
  requireLabelId,
  requireUserId,
  requireCommentId,
  requireComment,
  requireTitle,
  requireQuery,
  optionalHexColor,
  userSummary,
  commentSummary,
  optionalPage,
  optionalPerPage,
  optionalFilter,
  optionalSortBy,
  optionalOrder,
  optionalDescription,
  optionalPriority,
  optionalDueDate,
  optionalBoolean,
  optionalParentProjectId,
  buildQuery,
  paginatedResult,
  taskDetail,
  projectDetail,
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
  // Vikunja's project update (POST /projects/{id}) requires `title` and behaves
  // like a full replace — omitted fields can be zeroed. So fetch the current
  // project and send every editable field back, overriding only what changed.
  // `??` merges safely: it keeps falsy-but-valid changes (is_archived=false,
  // parent=0, description="") and only falls back to current on undefined.
  //
  // identifier/hex_color/is_favorite aren't settable via this server; they're
  // carried through unchanged purely so the full-replace POST doesn't clear
  // them. This is a read-modify-write, so a concurrent edit between the GET and
  // the POST is lost (no optimistic concurrency in the API) — accepted for a
  // single-user MCP.
  const updateProjectMerged = async (id, changes) => {
    const { data: current } = await api("GET", `/projects/${id}`);
    if (!current || current.id == null) {
      throw new Error("Vikunja returned no project");
    }
    const body = {
      title: changes.title ?? current.title,
      description: changes.description ?? current.description ?? "",
      identifier: current.identifier ?? "",
      hex_color: current.hex_color ?? "",
      parent_project_id: changes.parent_project_id ?? current.parent_project_id ?? 0,
      is_archived: changes.is_archived ?? current.is_archived ?? false,
      is_favorite: current.is_favorite ?? false,
    };
    const { data: project } = await api("POST", `/projects/${id}`, body);
    if (!project || project.id == null) {
      throw new Error("Vikunja returned an empty project response");
    }
    return projectDetail(project);
  };

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
      description:
        "Create a task in a project. Requires a title; optional description, due_date (ISO 8601), and priority (0-5).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          title: { type: "string", description: "Task title" },
          description: { type: "string", description: "Task description" },
          due_date: { type: "string", description: "Due date/time, ISO 8601 recommended (e.g. 2026-08-01T09:00:00Z)" },
          priority: { type: "number", description: "Priority 0-5 (0 = unset, 5 = DO NOW)" },
        },
        required: ["project_id", "title"],
        additionalProperties: false,
      },
      run: async ({ project_id, title, description, due_date, priority }) => {
        const id = requireProjectId(project_id);
        const body = { title: requireTitle(title) };
        const desc = optionalDescription(description);
        if (desc !== undefined) body.description = desc;
        const due = optionalDueDate(due_date);
        if (due !== undefined) body.due_date = due;
        const prio = optionalPriority(priority);
        if (prio !== undefined) body.priority = prio;
        const { data: task } = await api("PUT", `/projects/${id}/tasks`, body);
        if (!task || task.id == null) {
          throw new Error("Vikunja returned an empty task response");
        }
        return { id: task.id, title: task.title };
      },
    },
    {
      name: "update_task",
      tier: "write",
      description:
        "Update fields of an existing task by id (title, description, done, due_date, priority). Only the fields you pass are changed.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          title: { type: "string", description: "New title" },
          description: { type: "string", description: "New description" },
          done: { type: "boolean", description: "Mark done/undone" },
          due_date: { type: "string", description: "Due date/time, ISO 8601 recommended" },
          priority: { type: "number", description: "Priority 0-5" },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      run: async ({ task_id, title, description, done, due_date, priority }) => {
        const id = requireTaskId(task_id);
        const body = {};
        if (title !== undefined) body.title = requireTitle(title);
        const desc = optionalDescription(description);
        if (desc !== undefined) body.description = desc;
        const doneVal = optionalBoolean(done, "done");
        if (doneVal !== undefined) body.done = doneVal;
        const due = optionalDueDate(due_date);
        if (due !== undefined) body.due_date = due;
        const prio = optionalPriority(priority);
        if (prio !== undefined) body.priority = prio;
        if (Object.keys(body).length === 0) {
          throw new Error("update_task: no fields to update");
        }
        const { data: task } = await api("POST", `/tasks/${id}`, body);
        if (!task || task.id == null) {
          throw new Error("Vikunja returned an empty task response");
        }
        return taskDetail(task);
      },
    },
    {
      name: "set_task_done",
      tier: "write",
      description: "Mark a task done, or reopen it with done=false (defaults to done=true).",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          done: { type: "boolean", description: "true to complete (default), false to reopen" },
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      run: async ({ task_id, done }) => {
        const id = requireTaskId(task_id);
        const doneVal = done === undefined ? true : optionalBoolean(done, "done");
        const { data: task } = await api("POST", `/tasks/${id}`, { done: doneVal });
        if (!task || task.id == null) {
          throw new Error("Vikunja returned an empty task response");
        }
        return taskDetail(task);
      },
    },
    {
      name: "get_project",
      tier: "read",
      description:
        "Get one project by id (title, description, identifier, parent, archived/favorite flags).",
      inputSchema: {
        type: "object",
        properties: { project_id: { type: "number", description: "Vikunja project id" } },
        required: ["project_id"],
        additionalProperties: false,
      },
      run: async ({ project_id }) => {
        const id = requireProjectId(project_id);
        const { data } = await api("GET", `/projects/${id}`);
        if (!data || data.id == null) {
          throw new Error("Vikunja returned no project");
        }
        return projectDetail(data);
      },
    },
    {
      name: "create_project",
      tier: "additive",
      description:
        "Create a project. Requires a title; optional description and parent_project_id (nest under a parent).",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Project title" },
          description: { type: "string", description: "Project description" },
          parent_project_id: { type: "number", description: "Parent project id (omit for top level)" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      run: async ({ title, description, parent_project_id }) => {
        const body = { title: requireTitle(title) };
        const desc = optionalDescription(description);
        if (desc !== undefined) body.description = desc;
        const parent = optionalParentProjectId(parent_project_id);
        if (parent !== undefined) body.parent_project_id = parent;
        const { data: project } = await api("PUT", "/projects", body);
        if (!project || project.id == null) {
          throw new Error("Vikunja returned an empty project response");
        }
        return { id: project.id, title: project.title };
      },
    },
    {
      name: "update_project",
      tier: "write",
      description:
        "Update fields of a project by id (title, description, parent_project_id). Only the fields you pass are changed.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          title: { type: "string", description: "New title" },
          description: { type: "string", description: "New description" },
          parent_project_id: { type: "number", description: "New parent (0 = top level)" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
      run: async ({ project_id, title, description, parent_project_id }) => {
        const id = requireProjectId(project_id);
        const changes = {};
        if (title !== undefined) changes.title = requireTitle(title);
        const desc = optionalDescription(description);
        if (desc !== undefined) changes.description = desc;
        const parent = optionalParentProjectId(parent_project_id);
        if (parent !== undefined) changes.parent_project_id = parent;
        if (Object.keys(changes).length === 0) {
          throw new Error("update_project: no fields to update");
        }
        return updateProjectMerged(id, changes);
      },
    },
    {
      name: "archive_project",
      tier: "write",
      description: "Archive a project, or unarchive it with archived=false (defaults to archived=true).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          archived: { type: "boolean", description: "true to archive (default), false to unarchive" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
      run: async ({ project_id, archived }) => {
        const id = requireProjectId(project_id);
        const isArchived = archived === undefined ? true : optionalBoolean(archived, "archived");
        return updateProjectMerged(id, { is_archived: isArchived });
      },
    },
    {
      name: "delete_project",
      tier: "delete",
      description: "Delete a project by id (and its tasks). Irreversible.",
      inputSchema: {
        type: "object",
        properties: { project_id: { type: "number", description: "Vikunja project id" } },
        required: ["project_id"],
        additionalProperties: false,
      },
      run: async ({ project_id }) => {
        const id = requireProjectId(project_id);
        await api("DELETE", `/projects/${id}`);
        return { id, deleted: true };
      },
    },
    {
      name: "list_labels",
      tier: "read",
      description:
        "List the labels the token can see (id, title, hex_color). Paginated; request successive pages while page < total_pages.",
      inputSchema: {
        type: "object",
        properties: paginationSchema,
        additionalProperties: false,
      },
      run: async ({ page, per_page } = {}) => {
        const resolvedPage = optionalPage(page);
        const resolvedPerPage = optionalPerPage(per_page);
        const query = buildQuery({ page: resolvedPage, per_page: resolvedPerPage });
        const { data, headers } = await api("GET", `/labels${query}`);
        const items = (data ?? []).map((l) => ({ id: l.id, title: l.title, hex_color: l.hex_color ?? "" }));
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "create_label",
      tier: "additive",
      description: "Create a label. Requires a title; optional hex_color (6-digit hex like ff0000).",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Label title" },
          hex_color: { type: "string", description: "6-digit hex color, e.g. ff0000 (leading # allowed)" },
        },
        required: ["title"],
        additionalProperties: false,
      },
      run: async ({ title, hex_color }) => {
        const body = { title: requireTitle(title) };
        const hex = optionalHexColor(hex_color);
        if (hex !== undefined) body.hex_color = hex;
        const { data: label } = await api("PUT", "/labels", body);
        if (!label || label.id == null) {
          throw new Error("Vikunja returned an empty label response");
        }
        return { id: label.id, title: label.title, hex_color: label.hex_color ?? "" };
      },
    },
    {
      name: "add_label_to_task",
      tier: "additive",
      description: "Attach an existing label to a task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          label_id: { type: "number", description: "Vikunja label id" },
        },
        required: ["task_id", "label_id"],
        additionalProperties: false,
      },
      run: async ({ task_id, label_id }) => {
        const tid = requireTaskId(task_id);
        const lid = requireLabelId(label_id);
        await api("PUT", `/tasks/${tid}/labels`, { label_id: lid });
        return { task_id: tid, label_id: lid, added: true };
      },
    },
    {
      name: "remove_label_from_task",
      // Tier taxonomy: any HTTP DELETE / association-removal is classified
      // `delete` and gated behind ALLOW_DELETE. Detach is reversible (re-attach
      // restores it), so `write` would also be defensible, but we err toward the
      // stricter gate for anything that removes state. Same shape recurs for
      // assignees/comments/relations — keep them `delete` for consistency.
      tier: "delete",
      description: "Detach a label from a task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          label_id: { type: "number", description: "Vikunja label id" },
        },
        required: ["task_id", "label_id"],
        additionalProperties: false,
      },
      run: async ({ task_id, label_id }) => {
        const tid = requireTaskId(task_id);
        const lid = requireLabelId(label_id);
        await api("DELETE", `/tasks/${tid}/labels/${lid}`);
        return { task_id: tid, label_id: lid, removed: true };
      },
    },
    {
      name: "search_users",
      tier: "read",
      description:
        "Search users by a query string (id, username, name), e.g. to find someone to assign. Excludes yourself; may return an empty list.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Search text (username or name)" } },
        required: ["query"],
        additionalProperties: false,
      },
      run: async ({ query }) => {
        const q = requireQuery(query);
        const { data } = await api("GET", `/users${buildQuery({ s: q })}`);
        return { users: (data ?? []).map(userSummary) };
      },
    },
    {
      name: "list_task_assignees",
      tier: "read",
      description: "List the users assigned to a task (id, username, name).",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "number", description: "Vikunja task id" } },
        required: ["task_id"],
        additionalProperties: false,
      },
      // Vikunja v2.3.0's GET /tasks/{id}/assignees returns 500, so read the
      // assignees off the task object instead.
      run: async ({ task_id }) => {
        const tid = requireTaskId(task_id);
        const { data: task } = await api("GET", `/tasks/${tid}`);
        if (!task || task.id == null) {
          throw new Error("Vikunja returned no task");
        }
        return { task_id: tid, assignees: (task.assignees ?? []).map(userSummary) };
      },
    },
    {
      name: "assign_user",
      tier: "additive",
      description: "Assign a user to a task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          user_id: { type: "number", description: "Vikunja user id (see search_users)" },
        },
        required: ["task_id", "user_id"],
        additionalProperties: false,
      },
      run: async ({ task_id, user_id }) => {
        const tid = requireTaskId(task_id);
        const uid = requireUserId(user_id);
        await api("PUT", `/tasks/${tid}/assignees`, { user_id: uid });
        return { task_id: tid, user_id: uid, assigned: true };
      },
    },
    {
      name: "unassign_user",
      tier: "delete",
      description: "Remove a user's assignment from a task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          user_id: { type: "number", description: "Vikunja user id" },
        },
        required: ["task_id", "user_id"],
        additionalProperties: false,
      },
      run: async ({ task_id, user_id }) => {
        const tid = requireTaskId(task_id);
        const uid = requireUserId(user_id);
        await api("DELETE", `/tasks/${tid}/assignees/${uid}`);
        return { task_id: tid, user_id: uid, unassigned: true };
      },
    },
    {
      name: "list_task_comments",
      tier: "read",
      description:
        "List a task's comments (id, comment, author, created). Paginated; request successive pages while page < total_pages.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          ...paginationSchema,
        },
        required: ["task_id"],
        additionalProperties: false,
      },
      run: async ({ task_id, page, per_page }) => {
        const tid = requireTaskId(task_id);
        const resolvedPage = optionalPage(page);
        const resolvedPerPage = optionalPerPage(per_page);
        const query = buildQuery({ page: resolvedPage, per_page: resolvedPerPage });
        const { data, headers } = await api("GET", `/tasks/${tid}/comments${query}`);
        const items = (data ?? []).map(commentSummary);
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "add_task_comment",
      tier: "additive",
      description: "Add a comment to a task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          comment: { type: "string", description: "Comment text" },
        },
        required: ["task_id", "comment"],
        additionalProperties: false,
      },
      run: async ({ task_id, comment }) => {
        const tid = requireTaskId(task_id);
        const text = requireComment(comment);
        const { data } = await api("PUT", `/tasks/${tid}/comments`, { comment: text });
        if (!data || data.id == null) {
          throw new Error("Vikunja returned an empty comment response");
        }
        return commentSummary(data);
      },
    },
    {
      name: "delete_task_comment",
      tier: "delete",
      description: "Delete a comment from a task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          comment_id: { type: "number", description: "Vikunja comment id" },
        },
        required: ["task_id", "comment_id"],
        additionalProperties: false,
      },
      run: async ({ task_id, comment_id }) => {
        const tid = requireTaskId(task_id);
        const cid = requireCommentId(comment_id);
        await api("DELETE", `/tasks/${tid}/comments/${cid}`);
        return { task_id: tid, comment_id: cid, deleted: true };
      },
    },
  ];
}

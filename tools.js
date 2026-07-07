// Tool definitions for vikunja-mcp.
//
// Kept out of index.js (which owns the single network egress and the server
// wiring) so the handlers can be unit-tested with an injected fake api() — no
// server, no network. buildTools({ api }) returns the tool list; each tool
// carries a `tier` so index.js can gate write/delete behind opt-in env flags.

import {
  requireProjectId,
  requireTaskId,
  requirePositiveIntId,
  requireLabelId,
  requireUserId,
  requireCommentId,
  requireComment,
  requireFilename,
  requireNonEmptyString,
  requireTitle,
  requireQuery,
  optionalHexColor,
  userSummary,
  commentSummary,
  decodeBase64,
  attachmentSummary,
  bucketSummary,
  RELATION_KINDS,
  requireRelationKind,
  relationsShape,
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
  optionalPermission,
  SUBSCRIBABLE_ENTITIES,
  requireEntity,
  notificationSummary,
  requireExpiresAt,
  requirePermissionsMap,
  tokenSummary,
  buildQuery,
  paginatedResult,
  taskDetail,
  projectDetail,
  savedFilterDetail,
} from "./lib.js";

const paginationSchema = {
  page: { type: "number", description: "Page number (default: 1)" },
  per_page: {
    type: "number",
    description: "Items per page, 1-100 (Vikunja default if omitted)",
  },
};

const permissionSchema = {
  permission: {
    type: "number",
    description: "Access level: 0 read (default), 1 read+write, 2 admin",
    enum: [0, 1, 2],
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

  // Saved-filter update, like project update, requires a full body (POST /filters/{id}
  // 412s on a partial). Fetch current, override only what changed, preserving
  // the rest of the nested filters object (s/sort_by/order_by/include_nulls).
  const updateSavedFilterMerged = async (id, changes) => {
    const { data: current } = await api("GET", `/filters/${id}`);
    if (!current || current.id == null) {
      throw new Error("Vikunja returned no saved filter");
    }
    const body = {
      title: changes.title ?? current.title,
      description: changes.description ?? current.description ?? "",
      filters: { ...(current.filters ?? {}), filter: changes.filter ?? current.filters?.filter ?? "" },
      is_favorite: current.is_favorite ?? false,
    };
    const { data: updated } = await api("POST", `/filters/${id}`, body);
    if (!updated || updated.id == null) {
      throw new Error("Vikunja returned an empty saved filter response");
    }
    return savedFilterDetail(updated);
  };

  // Buckets live under a project's kanban view. Resolve it (the first kanban
  // view, if a project somehow has several) so bucket tools take a project_id —
  // agent-friendly — rather than a view id. Re-resolved per call rather than
  // cached, to keep the server stateless; it's one extra GET per bucket op.
  const kanbanViewId = async (projectId) => {
    const { data: views } = await api("GET", `/projects/${projectId}/views`);
    const kanban = (views ?? []).find((v) => v.view_kind === "kanban");
    if (!kanban) {
      throw new Error(`project ${projectId} has no kanban view`);
    }
    return kanban.id;
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
    {
      name: "list_task_relations",
      tier: "read",
      description:
        "List a task's relations, grouped by kind (subtask, blocking, related, ...) → tasks {id, title, done}.",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "number", description: "Vikunja task id" } },
        required: ["task_id"],
        additionalProperties: false,
      },
      run: async ({ task_id }) => {
        const tid = requireTaskId(task_id);
        const { data: task } = await api("GET", `/tasks/${tid}`);
        if (!task || task.id == null) {
          throw new Error("Vikunja returned no task");
        }
        return { task_id: tid, relations: relationsShape(task.related_tasks) };
      },
    },
    {
      name: "create_task_relation",
      tier: "additive",
      description:
        "Relate a task to another task. relation_kind is the relation from task_id's perspective (e.g. blocking, subtask, related).",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          other_task_id: { type: "number", description: "The other task's id" },
          relation_kind: { type: "string", description: "Relation kind", enum: RELATION_KINDS },
        },
        required: ["task_id", "other_task_id", "relation_kind"],
        additionalProperties: false,
      },
      run: async ({ task_id, other_task_id, relation_kind }) => {
        const tid = requireTaskId(task_id);
        const otherId = requirePositiveIntId(other_task_id, "other_task_id");
        const kind = requireRelationKind(relation_kind);
        await api("PUT", `/tasks/${tid}/relations`, { other_task_id: otherId, relation_kind: kind });
        return { task_id: tid, other_task_id: otherId, relation_kind: kind, created: true };
      },
    },
    {
      name: "delete_task_relation",
      tier: "delete",
      description: "Remove a relation between two tasks.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          other_task_id: { type: "number", description: "The other task's id" },
          relation_kind: { type: "string", description: "Relation kind", enum: RELATION_KINDS },
        },
        required: ["task_id", "other_task_id", "relation_kind"],
        additionalProperties: false,
      },
      run: async ({ task_id, other_task_id, relation_kind }) => {
        const tid = requireTaskId(task_id);
        const otherId = requirePositiveIntId(other_task_id, "other_task_id");
        const kind = requireRelationKind(relation_kind);
        await api("DELETE", `/tasks/${tid}/relations/${kind}/${otherId}`);
        return { task_id: tid, other_task_id: otherId, relation_kind: kind, deleted: true };
      },
    },
    {
      name: "list_task_attachments",
      tier: "read",
      description:
        "List a task's attachments (id, name, size, mime, created). Paginated; request successive pages while page < total_pages.",
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
        const { data, headers } = await api("GET", `/tasks/${tid}/attachments${query}`);
        const items = (data ?? []).map(attachmentSummary);
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "upload_task_attachment",
      tier: "additive",
      description:
        "Attach a file to a task. Provide a filename and the file's bytes as a base64 string.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          filename: { type: "string", description: "Name to store the file as" },
          content_base64: { type: "string", description: "File contents, base64-encoded" },
        },
        required: ["task_id", "filename", "content_base64"],
        additionalProperties: false,
      },
      run: async ({ task_id, filename, content_base64 }) => {
        const tid = requireTaskId(task_id);
        const name = requireFilename(filename);
        const bytes = decodeBase64(content_base64);
        const form = new FormData();
        form.append("files", new File([bytes], name));
        const { data } = await api("PUT", `/tasks/${tid}/attachments`, form);
        const uploaded = (data?.success ?? []).map(attachmentSummary);
        // Vikunja can return HTTP 200 with an empty success[] and populated
        // errors[] (size cap, quota, ...) — surface that instead of "nothing".
        if (uploaded.length === 0 && data?.errors?.length) {
          throw new Error(`upload failed: ${JSON.stringify(data.errors).slice(0, 400)}`);
        }
        return { task_id: tid, uploaded };
      },
    },
    {
      name: "delete_task_attachment",
      tier: "delete",
      description: "Delete an attachment from a task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "Vikunja task id" },
          attachment_id: { type: "number", description: "Vikunja attachment id" },
        },
        required: ["task_id", "attachment_id"],
        additionalProperties: false,
      },
      run: async ({ task_id, attachment_id }) => {
        const tid = requireTaskId(task_id);
        const aid = requirePositiveIntId(attachment_id, "attachment_id");
        await api("DELETE", `/tasks/${tid}/attachments/${aid}`);
        return { task_id: tid, attachment_id: aid, deleted: true };
      },
    },
    {
      name: "list_buckets",
      tier: "read",
      description:
        "List the kanban buckets of a project (id, title, task limit, task count). Resolves the project's first kanban view automatically.",
      inputSchema: {
        type: "object",
        properties: { project_id: { type: "number", description: "Vikunja project id" } },
        required: ["project_id"],
        additionalProperties: false,
      },
      run: async ({ project_id }) => {
        const pid = requireProjectId(project_id);
        const viewId = await kanbanViewId(pid);
        const { data } = await api("GET", `/projects/${pid}/views/${viewId}/buckets`);
        return { project_id: pid, view_id: viewId, buckets: (data ?? []).map(bucketSummary) };
      },
    },
    {
      name: "create_bucket",
      tier: "additive",
      description: "Create a kanban bucket (column) in a project's kanban view.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          title: { type: "string", description: "Bucket title" },
        },
        required: ["project_id", "title"],
        additionalProperties: false,
      },
      run: async ({ project_id, title }) => {
        const pid = requireProjectId(project_id);
        const bucketTitle = requireTitle(title);
        const viewId = await kanbanViewId(pid);
        const { data: bucket } = await api("PUT", `/projects/${pid}/views/${viewId}/buckets`, {
          title: bucketTitle,
        });
        if (!bucket || bucket.id == null) {
          throw new Error("Vikunja returned an empty bucket response");
        }
        return { id: bucket.id, title: bucket.title, view_id: viewId };
      },
    },
    {
      name: "move_task_to_bucket",
      tier: "write",
      description: "Move a task into a kanban bucket (column) of its project's kanban view.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          bucket_id: { type: "number", description: "Target bucket id (see list_buckets)" },
          task_id: { type: "number", description: "Task to move" },
        },
        required: ["project_id", "bucket_id", "task_id"],
        additionalProperties: false,
      },
      run: async ({ project_id, bucket_id, task_id }) => {
        const pid = requireProjectId(project_id);
        const bid = requirePositiveIntId(bucket_id, "bucket_id");
        const tid = requireTaskId(task_id);
        const viewId = await kanbanViewId(pid);
        await api("POST", `/projects/${pid}/views/${viewId}/buckets/${bid}/tasks`, { task_id: tid });
        return { project_id: pid, view_id: viewId, bucket_id: bid, task_id: tid, moved: true };
      },
    },
    {
      name: "list_teams",
      tier: "read",
      description:
        "List the teams the token can see (id, name). Paginated; request successive pages while page < total_pages.",
      inputSchema: { type: "object", properties: paginationSchema, additionalProperties: false },
      run: async ({ page, per_page } = {}) => {
        const resolvedPage = optionalPage(page);
        const resolvedPerPage = optionalPerPage(per_page);
        const query = buildQuery({ page: resolvedPage, per_page: resolvedPerPage });
        const { data, headers } = await api("GET", `/teams${query}`);
        const items = (data ?? []).map((t) => ({ id: t.id, name: t.name }));
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "create_team",
      tier: "additive",
      description: "Create a team.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Team name" } },
        required: ["name"],
        additionalProperties: false,
      },
      run: async ({ name }) => {
        const teamName = requireTitle(name);
        const { data: team } = await api("PUT", "/teams", { name: teamName });
        if (!team || team.id == null) {
          throw new Error("Vikunja returned an empty team response");
        }
        return { id: team.id, name: team.name };
      },
    },
    {
      name: "share_project_with_user",
      tier: "additive",
      description: "Share a project with a user at a permission level (default read).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          user_id: { type: "number", description: "Vikunja user id (see search_users)" },
          ...permissionSchema,
        },
        required: ["project_id", "user_id"],
        additionalProperties: false,
      },
      run: async ({ project_id, user_id, permission }) => {
        const pid = requireProjectId(project_id);
        const uid = requireUserId(user_id);
        const perm = optionalPermission(permission) ?? 0;
        // Report the permission Vikunja actually set (falling back to requested)
        // so a silently-downgraded grant is visible — consistent across the
        // three share tools.
        const { data } = await api("PUT", `/projects/${pid}/users`, { user_id: uid, permission: perm });
        return { project_id: pid, user_id: uid, permission: data?.permission ?? perm, shared: true };
      },
    },
    {
      name: "share_project_with_team",
      tier: "additive",
      description: "Share a project with a team at a permission level (default read).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          team_id: { type: "number", description: "Vikunja team id (see list_teams)" },
          ...permissionSchema,
        },
        required: ["project_id", "team_id"],
        additionalProperties: false,
      },
      run: async ({ project_id, team_id, permission }) => {
        const pid = requireProjectId(project_id);
        const tmid = requirePositiveIntId(team_id, "team_id");
        const perm = optionalPermission(permission) ?? 0;
        const { data } = await api("PUT", `/projects/${pid}/teams`, { team_id: tmid, permission: perm });
        return { project_id: pid, team_id: tmid, permission: data?.permission ?? perm, shared: true };
      },
    },
    {
      name: "create_link_share",
      tier: "additive",
      description:
        "Create a shareable link for a project at a permission level (default read). Returns the share hash — a capability secret that grants that access to anyone who has it, so treat it as sensitive.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "number", description: "Vikunja project id" },
          ...permissionSchema,
        },
        required: ["project_id"],
        additionalProperties: false,
      },
      run: async ({ project_id, permission }) => {
        const pid = requireProjectId(project_id);
        const perm = optionalPermission(permission) ?? 0;
        const { data: share } = await api("PUT", `/projects/${pid}/shares`, { permission: perm });
        if (!share || share.hash == null) {
          throw new Error("Vikunja returned an empty share response");
        }
        return { project_id: pid, hash: share.hash, permission: share.permission ?? perm };
      },
    },
    {
      name: "list_saved_filters",
      tier: "read",
      description:
        "List saved filters (id, title). Vikunja has no filters list endpoint — these are read from the projects list, where saved filters appear as negative-id pseudo-projects, so a very large number of projects could page some out.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        const { data } = await api("GET", "/projects");
        // filter_id = -project_id - 1 is an undocumented v2.3.0 internal for how
        // saved filters are encoded as pseudo-projects — re-verify on upgrades.
        const filters = (data ?? [])
          .filter((p) => p.id < 0)
          .map((p) => ({ id: -p.id - 1, title: p.title }));
        return { filters };
      },
    },
    {
      name: "create_saved_filter",
      tier: "additive",
      description:
        "Create a saved filter from a Vikunja filter query. Requires a title; optional description.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Filter title" },
          filter: { type: "string", description: 'Vikunja filter query, e.g. "done = false && priority >= 4"' },
          description: { type: "string", description: "Description" },
        },
        required: ["title", "filter"],
        additionalProperties: false,
      },
      run: async ({ title, filter, description }) => {
        const body = {
          title: requireTitle(title),
          filters: { filter: requireNonEmptyString(filter, "filter") },
        };
        const desc = optionalDescription(description);
        if (desc !== undefined) body.description = desc;
        const { data: saved } = await api("PUT", "/filters", body);
        if (!saved || saved.id == null) {
          throw new Error("Vikunja returned an empty saved filter response");
        }
        return { id: saved.id, title: saved.title };
      },
    },
    {
      name: "update_saved_filter",
      tier: "write",
      description: "Update a saved filter's title, description, or filter query. Only the fields you pass change.",
      inputSchema: {
        type: "object",
        properties: {
          filter_id: { type: "number", description: "Saved filter id" },
          title: { type: "string", description: "New title" },
          filter: { type: "string", description: "New Vikunja filter query" },
          description: { type: "string", description: "New description" },
        },
        required: ["filter_id"],
        additionalProperties: false,
      },
      run: async ({ filter_id, title, filter, description }) => {
        const id = requirePositiveIntId(filter_id, "filter_id");
        const changes = {};
        if (title !== undefined) changes.title = requireTitle(title);
        // A saved filter's query can't be emptied — if `filter` is passed it
        // must be a non-empty query (a clear error beats silently no-op'ing).
        if (filter !== undefined) changes.filter = requireNonEmptyString(filter, "filter");
        const desc = optionalDescription(description);
        if (desc !== undefined) changes.description = desc;
        if (Object.keys(changes).length === 0) {
          throw new Error("update_saved_filter: no fields to update");
        }
        return updateSavedFilterMerged(id, changes);
      },
    },
    {
      name: "delete_saved_filter",
      tier: "delete",
      description: "Delete a saved filter by id.",
      inputSchema: {
        type: "object",
        properties: { filter_id: { type: "number", description: "Saved filter id" } },
        required: ["filter_id"],
        additionalProperties: false,
      },
      run: async ({ filter_id }) => {
        const id = requirePositiveIntId(filter_id, "filter_id");
        await api("DELETE", `/filters/${id}`);
        return { id, deleted: true };
      },
    },
    {
      name: "list_notifications",
      tier: "read",
      description:
        "List the current user's notifications (id, name, read, created). Paginated; request successive pages while page < total_pages.",
      inputSchema: { type: "object", properties: paginationSchema, additionalProperties: false },
      run: async ({ page, per_page } = {}) => {
        const resolvedPage = optionalPage(page);
        const resolvedPerPage = optionalPerPage(per_page);
        const query = buildQuery({ page: resolvedPage, per_page: resolvedPerPage });
        const { data, headers } = await api("GET", `/notifications${query}`);
        const items = (data ?? []).map(notificationSummary);
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "mark_notification_read",
      tier: "write",
      description: "Mark a notification read, or unread with read=false (defaults to read=true).",
      inputSchema: {
        type: "object",
        properties: {
          notification_id: { type: "number", description: "Vikunja notification id" },
          read: { type: "boolean", description: "true to mark read (default), false to mark unread" },
        },
        required: ["notification_id"],
        additionalProperties: false,
      },
      run: async ({ notification_id, read }) => {
        const id = requirePositiveIntId(notification_id, "notification_id");
        const isRead = read === undefined ? true : optionalBoolean(read, "read");
        // Body shape inferred from Vikunja's DatabaseNotification.read json tag;
        // swagger documents no body and the throwaway test instance generates no
        // notifications, so this path is unit-tested only, not exercised live.
        await api("POST", `/notifications/${id}`, { read: isRead });
        return { notification_id: id, read: isRead, marked: true };
      },
    },
    {
      name: "subscribe",
      tier: "additive",
      description: "Subscribe the current user to a project or task to get its notifications.",
      inputSchema: {
        type: "object",
        properties: {
          entity: { type: "string", description: "What to subscribe to", enum: SUBSCRIBABLE_ENTITIES },
          entity_id: { type: "number", description: "Id of the project or task" },
        },
        required: ["entity", "entity_id"],
        additionalProperties: false,
      },
      run: async ({ entity, entity_id }) => {
        const ent = requireEntity(entity);
        const eid = requirePositiveIntId(entity_id, "entity_id");
        await api("PUT", `/subscriptions/${ent}/${eid}`);
        return { entity: ent, entity_id: eid, subscribed: true };
      },
    },
    {
      name: "unsubscribe",
      tier: "delete",
      description: "Unsubscribe the current user from a project or task.",
      inputSchema: {
        type: "object",
        properties: {
          entity: { type: "string", description: "What to unsubscribe from", enum: SUBSCRIBABLE_ENTITIES },
          entity_id: { type: "number", description: "Id of the project or task" },
        },
        required: ["entity", "entity_id"],
        additionalProperties: false,
      },
      run: async ({ entity, entity_id }) => {
        const ent = requireEntity(entity);
        const eid = requirePositiveIntId(entity_id, "entity_id");
        await api("DELETE", `/subscriptions/${ent}/${eid}`);
        return { entity: ent, entity_id: eid, unsubscribed: true };
      },
    },
    {
      name: "get_current_user",
      tier: "read",
      description: "Get the user the token belongs to (id, username, name).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => {
        const { data } = await api("GET", "/user");
        if (!data || data.id == null) {
          throw new Error("Vikunja returned no user");
        }
        return userSummary(data);
      },
    },
    {
      name: "list_api_tokens",
      tier: "read",
      description:
        "List the current user's API tokens (id, title, expires_at, permissions). The secret is never returned here — only when a token is created. Paginated.",
      inputSchema: { type: "object", properties: paginationSchema, additionalProperties: false },
      run: async ({ page, per_page } = {}) => {
        const resolvedPage = optionalPage(page);
        const resolvedPerPage = optionalPerPage(per_page);
        const query = buildQuery({ page: resolvedPage, per_page: resolvedPerPage });
        const { data, headers } = await api("GET", `/tokens${query}`);
        const items = (data ?? []).map(tokenSummary);
        return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage, headers);
      },
    },
    {
      name: "create_api_token",
      // Gated as write (not additive): minting a credential with caller-chosen
      // permissions + expiry is privilege escalation / persistence — a default
      // or hijacked install must not be able to do it. Not deletable "data"
      // like other additive tools; the secret is out the moment it's created.
      tier: "write",
      description:
        "Create a Vikunja API token. Requires a title, an expires_at (ISO 8601), and a non-empty permissions map (resource group -> action array, e.g. {\"tasks\":[\"read_all\"]}; see Vikunja's GET /routes). Returns the token secret ONCE — treat it as sensitive; it can't be retrieved later.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Token title" },
          expires_at: { type: "string", description: "Expiry, ISO 8601 (required by Vikunja)" },
          permissions: {
            type: "object",
            description: 'Resource group -> allowed actions, e.g. {"tasks":["read_all","read_one"]}',
          },
        },
        required: ["title", "expires_at", "permissions"],
        additionalProperties: false,
      },
      run: async ({ title, expires_at, permissions }) => {
        const body = {
          title: requireTitle(title),
          expires_at: requireExpiresAt(expires_at),
          permissions: requirePermissionsMap(permissions),
        };
        const { data: token } = await api("PUT", "/tokens", body);
        if (!token || token.id == null) {
          throw new Error("Vikunja returned an empty token response");
        }
        return { id: token.id, title: token.title, token: token.token, expires_at: token.expires_at ?? null };
      },
    },
  ];
}

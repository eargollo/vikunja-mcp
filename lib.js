// Pure helpers for vikunja-mcp: input validation, query building, and response
// shaping. Deliberately network-free — the single egress point stays in
// index.js's api(). Kept here so it can be unit-tested without starting the
// server or reaching Vikunja.

export function requireAbsoluteUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL (e.g. http://host:3456/api/v1)`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString().replace(/\/+$/, "");
}

// Coerce and validate a positive-integer id, naming the field in the error so
// tools with more than one id (e.g. task_id + other_task_id) report the right one.
export function requirePositiveIntId(value, name) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return id;
}

export function requireProjectId(value) {
  return requirePositiveIntId(value, "project_id");
}

export function requireTaskId(value) {
  return requirePositiveIntId(value, "task_id");
}

export function requireLabelId(value) {
  return requirePositiveIntId(value, "label_id");
}

export function requireUserId(value) {
  return requirePositiveIntId(value, "user_id");
}

export function userSummary(u) {
  return { id: u.id, username: u.username, name: u.name ?? "" };
}

// Trim and require a non-empty string, naming the field in the error.
export function requireNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must not be empty`);
  }
  return value.trim();
}

export function requireQuery(value) {
  return requireNonEmptyString(value, "query");
}

export function requireCommentId(value) {
  return requirePositiveIntId(value, "comment_id");
}

export function requireComment(value) {
  return requireNonEmptyString(value, "comment");
}

export function requireFilename(value) {
  return requireNonEmptyString(value, "filename");
}

// Decode a base64 string to a Buffer for multipart upload. Rejects empty and
// effectively-invalid input (base64 that decodes to nothing).
export function decodeBase64(value, name = "content_base64") {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a base64-encoded string`);
  }
  // Buffer.from(...,"base64") silently drops invalid chars, so validate the
  // shape first — otherwise malformed input uploads corrupted bytes.
  const normalized = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error(`${name} must be a base64-encoded string`);
  }
  const buf = Buffer.from(normalized, "base64");
  if (buf.length === 0) {
    throw new Error(`${name} must be a base64-encoded string`);
  }
  return buf;
}

export function attachmentSummary(a) {
  return {
    id: a.id,
    name: a.file?.name ?? null,
    size: a.file?.size ?? null,
    mime: a.file?.mime ?? null,
    created: a.created ?? null,
  };
}

export function bucketSummary(b) {
  return { id: b.id, title: b.title, limit: b.limit ?? 0, count: b.count ?? 0 };
}

export function savedFilterDetail(f) {
  return {
    id: f.id,
    title: f.title,
    description: f.description ?? "",
    filter: f.filters?.filter ?? "",
  };
}

export function requireExpiresAt(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("expires_at must be an ISO 8601 date string");
  }
  return new Date(value).toISOString();
}

export function requirePermissionsMap(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  ) {
    throw new Error("permissions must be a non-empty object mapping resource groups to action arrays");
  }
  return value;
}

export function tokenSummary(t) {
  // Never echoes `token` — the secret is only returned once, on creation.
  return {
    id: t.id,
    title: t.title,
    expires_at: t.expires_at ?? null,
    permissions: t.permissions ?? {},
  };
}

export function requireEvents(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((e) => typeof e === "string")) {
    throw new Error("events must be a non-empty array of event names (see Vikunja's GET /webhooks/events)");
  }
  return value;
}

export function webhookSummary(w) {
  // Never echoes `secret`/`basic_auth_password`.
  return { id: w.id, target_url: w.target_url, events: w.events ?? [] };
}

// Entities a user can subscribe to for notifications.
export const SUBSCRIBABLE_ENTITIES = ["project", "task"];

export function requireEntity(value) {
  if (typeof value !== "string" || !SUBSCRIBABLE_ENTITIES.includes(value)) {
    throw new Error(`entity must be one of: ${SUBSCRIBABLE_ENTITIES.join(", ")}`);
  }
  return value;
}

export function notificationSummary(n) {
  const readAt = n.read_at;
  const read = typeof readAt === "string" && readAt !== "" && !readAt.startsWith("0001-01-01");
  return { id: n.id, name: n.name ?? "", read, created: n.created ?? null };
}

// Vikunja sharing permission level: 0 = read, 1 = read+write, 2 = admin.
export function optionalPermission(value) {
  if (value === undefined) return undefined;
  const p = Number(value);
  if (!Number.isInteger(p) || p < 0 || p > 2) {
    throw new Error("permission must be 0 (read), 1 (read+write), or 2 (admin)");
  }
  return p;
}

export function commentSummary(c) {
  return {
    id: c.id,
    comment: c.comment,
    author: c.author?.username ?? null,
    created: c.created ?? null,
  };
}

// Vikunja's task relation kinds (excluding the internal "unknown").
export const RELATION_KINDS = [
  "subtask",
  "parenttask",
  "related",
  "duplicateof",
  "duplicates",
  "blocking",
  "blocked",
  "precedes",
  "follows",
  "copiedfrom",
  "copiedto",
];

export function requireRelationKind(value) {
  if (typeof value !== "string" || !RELATION_KINDS.includes(value)) {
    throw new Error(`relation_kind must be one of: ${RELATION_KINDS.join(", ")}`);
  }
  return value;
}

// A task's related_tasks is an object keyed by relation kind → array of tasks.
// Shape each into a compact {id, title, done}.
export function relationsShape(related) {
  const out = {};
  for (const [kind, tasks] of Object.entries(related ?? {})) {
    out[kind] = (tasks ?? []).map((t) => ({ id: t.id, title: t.title, done: t.done }));
  }
  return out;
}

export function optionalHexColor(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("hex_color must be a 6-digit hex string (e.g. ff0000)");
  }
  const hex = value.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) {
    throw new Error("hex_color must be a 6-digit hex string (e.g. ff0000)");
  }
  return hex;
}

export function requireTitle(value) {
  if (typeof value !== "string") {
    throw new Error("title must be a string");
  }
  const title = value.trim();
  if (!title) {
    throw new Error("title must not be empty");
  }
  return title;
}

export function optionalPage(value) {
  if (value === undefined) return undefined;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("page must be a positive integer");
  }
  return page;
}

export function optionalPerPage(value) {
  if (value === undefined) return undefined;
  const perPage = Number(value);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
    throw new Error("per_page must be an integer between 1 and 100");
  }
  return perPage;
}

export function optionalDescription(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("description must be a string");
  }
  return value; // empty string is allowed — it clears the description
}

export function optionalPriority(value) {
  if (value === undefined) return undefined;
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < 0 || priority > 5) {
    throw new Error("priority must be an integer between 0 and 5");
  }
  return priority;
}

export function optionalDueDate(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("due_date must be an ISO 8601 date string");
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    throw new Error("due_date must be an ISO 8601 date string");
  }
  return new Date(ts).toISOString();
}

export function optionalParentProjectId(value) {
  if (value === undefined) return undefined;
  const id = Number(value);
  // 0 means "no parent" (top-level) in Vikunja; positive ids nest under a parent.
  if (!Number.isInteger(id) || id < 0) {
    throw new Error("parent_project_id must be a non-negative integer (0 = top level)");
  }
  return id;
}

export function projectDetail(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description ?? "",
    identifier: p.identifier ?? "",
    parent_project_id: p.parent_project_id ? p.parent_project_id : null,
    is_archived: p.is_archived ?? false,
    is_favorite: p.is_favorite ?? false,
  };
}

export function optionalBoolean(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

export function optionalFilter(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("filter must be a string");
  }
  const filter = value.trim();
  return filter === "" ? undefined : filter;
}

export function optionalSortBy(value) {
  if (value === undefined) return undefined;
  // A bare field name only — never arbitrary text — so it can't smuggle
  // operators or extra query params into the Vikunja request.
  if (typeof value !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error("sort_by must be a field name (letters, digits, underscore)");
  }
  return value;
}

export function optionalOrder(value) {
  if (value === undefined) return undefined;
  const order = String(value).toLowerCase();
  if (order !== "asc" && order !== "desc") {
    throw new Error("order_by must be 'asc' or 'desc'");
  }
  return order;
}

// Shape Vikunja's rich task object into a curated, agent-friendly detail view.
// Drops fields owned by other tools/epics and normalizes Vikunja's zero-value
// dates ("0001-01-01…") to null.
export function taskDetail(t) {
  const clean = (d) => (typeof d === "string" && !d.startsWith("0001-01-01") ? d : null);
  const detail = {
    id: t.id,
    title: t.title,
    description: t.description ?? "",
    done: t.done ?? false,
    project_id: t.project_id,
    priority: t.priority ?? 0,
    percent_done: t.percent_done ?? 0,
    due_date: clean(t.due_date),
    start_date: clean(t.start_date),
    end_date: clean(t.end_date),
    identifier: t.identifier ?? "",
  };
  if (Array.isArray(t.labels) && t.labels.length) {
    detail.labels = t.labels.map((l) => ({ id: l.id, title: l.title }));
  }
  if (Array.isArray(t.assignees) && t.assignees.length) {
    detail.assignees = t.assignees.map((a) => ({ id: a.id, username: a.username }));
  }
  return detail;
}

export function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined) search.set(key, String(val));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function paginatedResult(items, page, perPage, headers) {
  // Vikunja reports the authoritative page count in a response header; the
  // frontend paginates off this too. Prefer it over guessing from page size,
  // since Vikunja clamps per_page to its configured maximum server-side.
  const totalPages = Number(headers?.get("x-pagination-total-pages"));
  return {
    page,
    ...(perPage !== undefined ? { per_page: perPage } : {}),
    ...(Number.isInteger(totalPages) && totalPages > 0 ? { total_pages: totalPages } : {}),
    count: items.length,
    items,
  };
}

// Interpret an env-var value as a boolean feature flag. Only an explicit,
// affirmative value turns a gated capability on; anything else (unset, "0",
// "false", garbage) leaves it off — fail safe, never fail open.
export function flagEnabled(value) {
  if (value === undefined || value === null) return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

// Decide whether a tool of the given tier may be exposed. Read + additive are
// always on; write (update) and delete (destructive) require their opt-in flag,
// so a default install can never modify or destroy data.
export function tierAllowed(tier, { allowWrite = false, allowDelete = false } = {}) {
  if (tier === "read" || tier === "additive") return true;
  if (tier === "write") return allowWrite;
  if (tier === "delete") return allowDelete;
  return false; // unknown/typo tier: stay hidden — never fail open
}

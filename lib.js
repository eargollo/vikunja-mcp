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

export function requireProjectId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("project_id must be a positive integer");
  }
  return id;
}

export function requireTaskId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("task_id must be a positive integer");
  }
  return id;
}

export function requireLabelId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("label_id must be a positive integer");
  }
  return id;
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

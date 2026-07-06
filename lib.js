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

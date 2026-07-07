// Unit tests for the pure helpers in lib.js. No network, no server — runs with
// the built-in Node test runner (`node --test`), zero extra dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  requireAbsoluteUrl,
  requireProjectId,
  requireTitle,
  optionalPage,
  optionalPerPage,
  buildQuery,
  paginatedResult,
  listResult,
  okResult,
  flagEnabled,
  tierAllowed,
  requireTaskId,
  optionalFilter,
  optionalSortBy,
  optionalOrder,
  taskDetail,
  optionalDescription,
  optionalPriority,
  optionalDueDate,
  optionalBoolean,
  optionalParentProjectId,
  projectDetail,
  requireLabelId,
  optionalHexColor,
  requireUserId,
  userSummary,
  requireQuery,
  requireCommentId,
  requireComment,
  commentSummary,
  RELATION_KINDS,
  requireRelationKind,
  relationsShape,
  requirePositiveIntId,
  requireFilename,
  decodeBase64,
  attachmentSummary,
  bucketSummary,
  optionalPermission,
  savedFilterDetail,
  SUBSCRIBABLE_ENTITIES,
  requireEntity,
  notificationSummary,
  requireExpiresAt,
  requirePermissionsMap,
  tokenSummary,
  requireEvents,
  webhookSummary,
} from "../lib.js";

test("requireAbsoluteUrl accepts http/https and strips trailing slashes", () => {
  assert.equal(requireAbsoluteUrl("http://host:3456/api/v1", "VIKUNJA_URL"), "http://host:3456/api/v1");
  assert.equal(requireAbsoluteUrl("https://host/api/v1/", "VIKUNJA_URL"), "https://host/api/v1");
  assert.equal(requireAbsoluteUrl("http://host/api/v1///", "VIKUNJA_URL"), "http://host/api/v1");
});

test("requireAbsoluteUrl rejects unparseable and non-http URLs", () => {
  assert.throws(() => requireAbsoluteUrl("not a url", "VIKUNJA_URL"), /absolute URL/);
  assert.throws(() => requireAbsoluteUrl("/api/v1", "VIKUNJA_URL"), /absolute URL/);
  assert.throws(() => requireAbsoluteUrl(undefined, "VIKUNJA_URL"), /absolute URL/);
  // "host:3456/..." parses with protocol "host:", so it fails the scheme check.
  assert.throws(() => requireAbsoluteUrl("host:3456/api/v1", "VIKUNJA_URL"), /http or https/);
  assert.throws(() => requireAbsoluteUrl("ftp://host/api", "VIKUNJA_URL"), /http or https/);
  assert.throws(() => requireAbsoluteUrl("file:///etc/passwd", "VIKUNJA_URL"), /http or https/);
});

test("requirePositiveIntId names the field in its error", () => {
  assert.equal(requirePositiveIntId("5", "other_task_id"), 5);
  assert.throws(() => requirePositiveIntId(-1, "other_task_id"), /other_task_id must be a positive integer/);
  assert.throws(() => requirePositiveIntId("x", "webhook_id"), /webhook_id must be a positive integer/);
});

test("requireProjectId accepts positive integers, coerces numeric strings", () => {
  assert.equal(requireProjectId(1), 1);
  assert.equal(requireProjectId("42"), 42);
});

test("requireProjectId rejects zero, negatives, and non-integers", () => {
  for (const bad of [0, -1, 1.5, "abc", "", null, undefined, NaN]) {
    assert.throws(() => requireProjectId(bad), /positive integer/, `should reject ${String(bad)}`);
  }
});

test("requireTitle trims and requires a non-empty string", () => {
  assert.equal(requireTitle("  hello  "), "hello");
  assert.equal(requireTitle("task"), "task");
});

test("requireTitle rejects empty, whitespace-only, and non-strings", () => {
  assert.throws(() => requireTitle(""), /must not be empty/);
  assert.throws(() => requireTitle("   "), /must not be empty/);
  assert.throws(() => requireTitle(123), /must be a string/);
  assert.throws(() => requireTitle(null), /must be a string/);
  assert.throws(() => requireTitle(undefined), /must be a string/);
});

test("optionalPage returns undefined when omitted, else a positive integer", () => {
  assert.equal(optionalPage(undefined), undefined);
  assert.equal(optionalPage(1), 1);
  assert.equal(optionalPage("3"), 3);
  assert.throws(() => optionalPage(0), /positive integer/);
  assert.throws(() => optionalPage(-2), /positive integer/);
  assert.throws(() => optionalPage(2.5), /positive integer/);
});

test("optionalPerPage enforces the 1-100 range", () => {
  assert.equal(optionalPerPage(undefined), undefined);
  assert.equal(optionalPerPage(1), 1);
  assert.equal(optionalPerPage(100), 100);
  assert.equal(optionalPerPage("50"), 50);
  assert.throws(() => optionalPerPage(0), /between 1 and 100/);
  assert.throws(() => optionalPerPage(101), /between 1 and 100/);
  assert.throws(() => optionalPerPage(2.5), /between 1 and 100/);
});

test("buildQuery omits undefined values and encodes the rest", () => {
  assert.equal(buildQuery({ page: undefined, per_page: undefined }), "");
  assert.equal(buildQuery({ page: 2 }), "?page=2");
  assert.equal(buildQuery({ page: 2, per_page: 50 }), "?page=2&per_page=50");
  assert.equal(buildQuery({ page: undefined, per_page: 10 }), "?per_page=10");
});

test("paginatedResult wraps items with page/count and uses the header page count", () => {
  const headers = new Headers({ "x-pagination-total-pages": "7" });
  const result = paginatedResult([{ id: 1 }, { id: 2 }], 1, 50, headers);
  assert.deepEqual(result, {
    page: 1,
    per_page: 50,
    total_pages: 7,
    count: 2,
    items: [{ id: 1 }, { id: 2 }],
  });
});

test("paginatedResult omits per_page and total_pages when unavailable", () => {
  const headers = new Headers();
  const result = paginatedResult([], 1, undefined, headers);
  assert.deepEqual(result, { page: 1, count: 0, items: [] });
});

test("paginatedResult tolerates a missing headers object", () => {
  const result = paginatedResult([{ id: 9 }], 3, undefined, undefined);
  assert.deepEqual(result, { page: 3, count: 1, items: [{ id: 9 }] });
});

test("flagEnabled treats 1/true/yes/on (any case, trimmed) as enabled", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on", " 1 ", "On"]) {
    assert.equal(flagEnabled(v), true, `should enable ${JSON.stringify(v)}`);
  }
});

test("flagEnabled treats everything else as disabled", () => {
  for (const v of [undefined, null, "", "0", "false", "no", "off", "2", "x"]) {
    assert.equal(flagEnabled(v), false, `should disable ${JSON.stringify(v)}`);
  }
});

test("tierAllowed: read/additive always on; write/delete need their flag", () => {
  const off = { allowWrite: false, allowDelete: false };
  assert.equal(tierAllowed("read", off), true);
  assert.equal(tierAllowed("additive", off), true);
  assert.equal(tierAllowed("write", off), false);
  assert.equal(tierAllowed("delete", off), false);
  assert.equal(tierAllowed("write", { allowWrite: true, allowDelete: false }), true);
  assert.equal(tierAllowed("delete", { allowWrite: false, allowDelete: true }), true);
});

test("tierAllowed defaults to gated when flags are omitted", () => {
  assert.equal(tierAllowed("write"), false);
  assert.equal(tierAllowed("delete"), false);
  assert.equal(tierAllowed("read"), true);
});

test("tierAllowed hides unknown/typo tiers even with both flags on (fail safe)", () => {
  const open = { allowWrite: true, allowDelete: true };
  assert.equal(tierAllowed("wrtie", open), false);
  assert.equal(tierAllowed("admin", open), false);
  assert.equal(tierAllowed(undefined, open), false);
});

test("requireTaskId accepts positive integers and rejects the rest", () => {
  assert.equal(requireTaskId(1), 1);
  assert.equal(requireTaskId("42"), 42);
  for (const bad of [0, -1, 1.5, "abc", "", null, undefined, NaN]) {
    assert.throws(() => requireTaskId(bad), /positive integer/, `should reject ${String(bad)}`);
  }
});

test("optionalFilter returns a trimmed string, undefined when absent/blank", () => {
  assert.equal(optionalFilter(undefined), undefined);
  assert.equal(optionalFilter("   "), undefined);
  assert.equal(optionalFilter("  done = false  "), "done = false");
  assert.throws(() => optionalFilter(123), /filter must be a string/);
});

test("optionalSortBy allows a field name and rejects injection-y input", () => {
  assert.equal(optionalSortBy(undefined), undefined);
  assert.equal(optionalSortBy("due_date"), "due_date");
  assert.equal(optionalSortBy("priority"), "priority");
  for (const bad of ["due date", "a;b", "done=1", "1bad", 5]) {
    assert.throws(() => optionalSortBy(bad), /sort_by/, `should reject ${String(bad)}`);
  }
});

test("optionalOrder normalizes asc/desc and rejects others", () => {
  assert.equal(optionalOrder(undefined), undefined);
  assert.equal(optionalOrder("asc"), "asc");
  assert.equal(optionalOrder("DESC"), "desc");
  assert.throws(() => optionalOrder("sideways"), /asc.*desc/);
});

test("listResult wraps items with count and optional context", () => {
  assert.deepEqual(listResult([{ id: 1 }]), { count: 1, items: [{ id: 1 }] });
  assert.deepEqual(listResult([], { task_id: 7 }), { task_id: 7, count: 0, items: [] });
});

test("okResult returns a uniform mutation confirmation", () => {
  assert.deepEqual(okResult({ task_id: 7, label_id: 3 }), { ok: true, task_id: 7, label_id: 3 });
});

test("taskDetail curates fields, nulls Vikunja zero-dates, maps labels/assignees", () => {
  const detail = taskDetail({
    id: 7,
    title: "T",
    description: "d",
    done: false,
    project_id: 3,
    priority: 4,
    percent_done: 0.5,
    due_date: "2026-01-02T00:00:00Z",
    start_date: "0001-01-01T00:00:00Z",
    end_date: "0001-01-01T00:00:00Z",
    identifier: "INBOX-7",
    labels: [{ id: 1, title: "urgent", extra: "x" }],
    assignees: [{ id: 9, username: "me", extra: "x" }],
    secret: "dropme",
  });
  assert.deepEqual(detail, {
    id: 7,
    title: "T",
    description: "d",
    done: false,
    project_id: 3,
    priority: 4,
    percent_done: 0.5,
    due_date: "2026-01-02T00:00:00Z",
    start_date: null,
    end_date: null,
    identifier: "INBOX-7",
    labels: [{ id: 1, title: "urgent" }],
    assignees: [{ id: 9, username: "me" }],
  });
});

test("taskDetail omits labels/assignees when absent or empty", () => {
  const detail = taskDetail({ id: 1, title: "x", done: true, project_id: 1, labels: null, assignees: [] });
  assert.ok(!("labels" in detail));
  assert.ok(!("assignees" in detail));
});

test("taskDetail preserves zero priority/percent_done and defaults identifier to ''", () => {
  const detail = taskDetail({ id: 1, title: "x", done: false, project_id: 1, priority: 0, percent_done: 0 });
  assert.equal(detail.priority, 0);
  assert.equal(detail.percent_done, 0);
  assert.equal(detail.identifier, "");
});

test("optionalDescription passes any string through (incl. empty), rejects non-strings", () => {
  assert.equal(optionalDescription(undefined), undefined);
  assert.equal(optionalDescription(""), "");
  assert.equal(optionalDescription("multi\nline"), "multi\nline");
  assert.throws(() => optionalDescription(5), /description must be a string/);
});

test("optionalPriority accepts integers 0-5, rejects out-of-range and non-integers", () => {
  assert.equal(optionalPriority(undefined), undefined);
  assert.equal(optionalPriority(0), 0);
  assert.equal(optionalPriority(5), 5);
  assert.equal(optionalPriority("3"), 3);
  for (const bad of [-1, 6, 2.5, "x"]) {
    assert.throws(() => optionalPriority(bad), /priority/, `should reject ${String(bad)}`);
  }
});

test("optionalDueDate normalizes valid dates to ISO and rejects junk", () => {
  assert.equal(optionalDueDate(undefined), undefined);
  assert.equal(optionalDueDate("2026-08-01T09:00:00Z"), "2026-08-01T09:00:00.000Z");
  assert.equal(optionalDueDate("2026-08-01"), "2026-08-01T00:00:00.000Z");
  assert.throws(() => optionalDueDate("not a date"), /due_date/);
  assert.throws(() => optionalDueDate(123), /due_date/);
});

test("optionalBoolean requires a real boolean", () => {
  assert.equal(optionalBoolean(undefined, "done"), undefined);
  assert.equal(optionalBoolean(true, "done"), true);
  assert.equal(optionalBoolean(false, "done"), false);
  for (const bad of ["true", 1, 0, null]) {
    assert.throws(() => optionalBoolean(bad, "done"), /done must be a boolean/);
  }
});

test("optionalParentProjectId accepts 0 (top-level) and positive ints, rejects the rest", () => {
  assert.equal(optionalParentProjectId(undefined), undefined);
  assert.equal(optionalParentProjectId(0), 0);
  assert.equal(optionalParentProjectId(7), 7);
  assert.equal(optionalParentProjectId("3"), 3);
  for (const bad of [-1, 1.5, "x"]) {
    assert.throws(() => optionalParentProjectId(bad), /parent_project_id/, `should reject ${String(bad)}`);
  }
});

test("projectDetail curates fields and nulls a zero parent", () => {
  assert.deepEqual(
    projectDetail({
      id: 4,
      title: "Work",
      description: "d",
      identifier: "WRK",
      parent_project_id: 0,
      is_archived: false,
      is_favorite: true,
      owner: { id: 1 },
      secret: "drop",
    }),
    {
      id: 4,
      title: "Work",
      description: "d",
      identifier: "WRK",
      parent_project_id: null,
      is_archived: false,
      is_favorite: true,
    },
  );
  assert.equal(projectDetail({ id: 1, title: "x", parent_project_id: 9 }).parent_project_id, 9);
});

test("requireLabelId accepts positive integers, rejects the rest", () => {
  assert.equal(requireLabelId(1), 1);
  assert.equal(requireLabelId("42"), 42);
  for (const bad of [0, -1, 1.5, "x", null, undefined]) {
    assert.throws(() => requireLabelId(bad), /label_id must be a positive integer/, `reject ${String(bad)}`);
  }
});

test("optionalHexColor normalizes to 6 lowercase hex digits, strips '#', rejects junk", () => {
  assert.equal(optionalHexColor(undefined), undefined);
  assert.equal(optionalHexColor("ff0000"), "ff0000");
  assert.equal(optionalHexColor("#FF0000"), "ff0000");
  assert.equal(optionalHexColor("AbCdEf"), "abcdef");
  for (const bad of ["abc", "gggggg", "#12345", "1234567", 123]) {
    assert.throws(() => optionalHexColor(bad), /hex_color/, `reject ${String(bad)}`);
  }
});

test("requireUserId accepts positive integers, rejects the rest", () => {
  assert.equal(requireUserId(1), 1);
  assert.equal(requireUserId("42"), 42);
  for (const bad of [0, -1, 1.5, "x", null, undefined]) {
    assert.throws(() => requireUserId(bad), /user_id must be a positive integer/, `reject ${String(bad)}`);
  }
});

test("userSummary curates id/username/name and defaults name to ''", () => {
  assert.deepEqual(userSummary({ id: 1, username: "me", name: "Me", email: "x", secret: "drop" }), {
    id: 1,
    username: "me",
    name: "Me",
  });
  assert.deepEqual(userSummary({ id: 2, username: "u" }), { id: 2, username: "u", name: "" });
});

test("requireQuery trims and requires a non-empty string", () => {
  assert.equal(requireQuery("  hi  "), "hi");
  for (const bad of ["", "   ", 5, null, undefined]) {
    assert.throws(() => requireQuery(bad), /query must not be empty/, `reject ${String(bad)}`);
  }
});

test("requireCommentId accepts positive integers, rejects the rest", () => {
  assert.equal(requireCommentId(1), 1);
  assert.equal(requireCommentId("42"), 42);
  for (const bad of [0, -1, 1.5, "x", null, undefined]) {
    assert.throws(() => requireCommentId(bad), /comment_id must be a positive integer/, `reject ${String(bad)}`);
  }
});

test("requireComment trims and requires non-empty text", () => {
  assert.equal(requireComment("  hello  "), "hello");
  assert.equal(requireComment("multi\nline"), "multi\nline");
  for (const bad of ["", "   ", 5, null, undefined]) {
    assert.throws(() => requireComment(bad), /comment must not be empty/, `reject ${String(bad)}`);
  }
});

test("requireRelationKind accepts known kinds, rejects the rest", () => {
  for (const k of ["related", "subtask", "blocking", "duplicateof"]) {
    assert.equal(requireRelationKind(k), k);
  }
  assert.ok(RELATION_KINDS.includes("related"));
  for (const bad of ["friend", "", "RELATED", 5, null, undefined]) {
    assert.throws(() => requireRelationKind(bad), /relation_kind must be one of/, `reject ${String(bad)}`);
  }
});

test("requireFilename trims and requires a non-empty string", () => {
  assert.equal(requireFilename("  note.txt  "), "note.txt");
  for (const bad of ["", "   ", 5, null, undefined]) {
    assert.throws(() => requireFilename(bad), /filename must not be empty/, `reject ${String(bad)}`);
  }
});

test("decodeBase64 decodes valid base64 to bytes, rejects empty/invalid", () => {
  const buf = decodeBase64(Buffer.from("hello").toString("base64"));
  assert.equal(Buffer.from(buf).toString("utf8"), "hello");
  // reject malformed base64 that Buffer.from would leniently half-decode
  for (const bad of ["", "   ", "!!!", "aGVsbG8=extra", "not base64!!", 5, null, undefined]) {
    assert.throws(() => decodeBase64(bad), /base64/, `reject ${String(bad)}`);
  }
});

test("requireExpiresAt normalizes a valid date to ISO, rejects junk/non-string", () => {
  assert.equal(requireExpiresAt("2027-01-01T00:00:00Z"), "2027-01-01T00:00:00.000Z");
  for (const bad of ["nope", "", 5, null, undefined]) {
    assert.throws(() => requireExpiresAt(bad), /expires_at/, `reject ${String(bad)}`);
  }
});

test("requirePermissionsMap requires a non-empty plain object", () => {
  assert.deepEqual(requirePermissionsMap({ tasks: ["read_all"] }), { tasks: ["read_all"] });
  for (const bad of [{}, [], null, "x", 5, undefined]) {
    assert.throws(() => requirePermissionsMap(bad), /permissions must be/, `reject ${JSON.stringify(bad)}`);
  }
});

test("tokenSummary curates id/title/expires_at/permissions (never the secret)", () => {
  assert.deepEqual(
    tokenSummary({ id: 1, title: "CI", expires_at: "2027-01-01T00:00:00Z", permissions: { tasks: ["read_all"] }, token: "tk_secret" }),
    { id: 1, title: "CI", expires_at: "2027-01-01T00:00:00Z", permissions: { tasks: ["read_all"] } },
  );
  assert.deepEqual(tokenSummary({ id: 2, title: "x" }), { id: 2, title: "x", expires_at: null, permissions: {} });
});

test("requireEvents requires a non-empty array of event strings", () => {
  assert.deepEqual(requireEvents(["task.created", "task.updated"]), ["task.created", "task.updated"]);
  for (const bad of [[], ["ok", 5], "task.created", {}, null, undefined]) {
    assert.throws(() => requireEvents(bad), /events must be/, `reject ${JSON.stringify(bad)}`);
  }
});

test("webhookSummary curates id/target_url/events, never the secret", () => {
  assert.deepEqual(
    webhookSummary({
      id: 3,
      target_url: "https://example.com/hook",
      events: ["task.created"],
      secret: "s3cr3t",
      basic_auth_password: "p",
    }),
    { id: 3, target_url: "https://example.com/hook", events: ["task.created"] },
  );
  assert.deepEqual(webhookSummary({ id: 4, target_url: "https://x" }), {
    id: 4,
    target_url: "https://x",
    events: [],
  });
});

test("requireEntity accepts project/task, rejects others", () => {
  assert.equal(requireEntity("project"), "project");
  assert.equal(requireEntity("task"), "task");
  assert.ok(SUBSCRIBABLE_ENTITIES.includes("task"));
  for (const bad of ["label", "TASK", "", 5, null, undefined]) {
    assert.throws(() => requireEntity(bad), /entity must be one of/, `reject ${String(bad)}`);
  }
});

test("notificationSummary marks read from a real read_at, ignoring zero-dates/null", () => {
  assert.deepEqual(
    notificationSummary({ id: 3, name: "task.assigned", read_at: "2026-01-01T00:00:00Z", created: "2026-01-01T00:00:00Z", notification: {} }),
    { id: 3, name: "task.assigned", read: true, created: "2026-01-01T00:00:00Z" },
  );
  assert.equal(notificationSummary({ id: 4, name: "x", read_at: "0001-01-01T00:00:00Z" }).read, false);
  assert.equal(notificationSummary({ id: 5, name: "x" }).read, false);
});

test("optionalPermission accepts 0/1/2, rejects out-of-range and non-integers", () => {
  assert.equal(optionalPermission(undefined), undefined);
  for (const ok of [0, 1, 2, "2"]) assert.equal(optionalPermission(ok), Number(ok));
  for (const bad of [-1, 3, 1.5, "x"]) {
    assert.throws(() => optionalPermission(bad), /permission must be/, `reject ${String(bad)}`);
  }
});

test("savedFilterDetail curates id/title/description/filter", () => {
  assert.deepEqual(
    savedFilterDetail({
      id: 3,
      title: "Urgent",
      description: "d",
      filters: { s: "", sort_by: null, filter: "priority >= 4", filter_include_nulls: false },
      owner: {},
    }),
    { id: 3, title: "Urgent", description: "d", filter: "priority >= 4" },
  );
  assert.deepEqual(savedFilterDetail({ id: 1, title: "x" }), {
    id: 1,
    title: "x",
    description: "",
    filter: "",
  });
});

test("bucketSummary curates id/title/limit/count with numeric defaults", () => {
  assert.deepEqual(bucketSummary({ id: 2, title: "Doing", limit: 5, count: 3, tasks: [], secret: "x" }), {
    id: 2,
    title: "Doing",
    limit: 5,
    count: 3,
  });
  assert.deepEqual(bucketSummary({ id: 1, title: "To-Do" }), { id: 1, title: "To-Do", limit: 0, count: 0 });
});

test("attachmentSummary curates id/name/size/mime/created from the nested file", () => {
  assert.deepEqual(
    attachmentSummary({
      id: 3,
      file: { name: "a.txt", size: 17, mime: "text/plain", secret: "x" },
      created: "2026-01-01T00:00:00Z",
    }),
    { id: 3, name: "a.txt", size: 17, mime: "text/plain", created: "2026-01-01T00:00:00Z" },
  );
  assert.deepEqual(attachmentSummary({ id: 4 }), {
    id: 4,
    name: null,
    size: null,
    mime: null,
    created: null,
  });
});

test("relationsShape maps each kind's tasks to id/title/done, tolerates null", () => {
  assert.deepEqual(
    relationsShape({
      related: [{ id: 2, title: "B", done: false, description: "drop" }],
      blocking: [{ id: 3, title: "C", done: true }],
    }),
    {
      related: [{ id: 2, title: "B", done: false }],
      blocking: [{ id: 3, title: "C", done: true }],
    },
  );
  assert.deepEqual(relationsShape(null), {});
  assert.deepEqual(relationsShape({ related: null }), { related: [] });
});

test("commentSummary curates id/comment/author/created", () => {
  assert.deepEqual(
    commentSummary({
      id: 3,
      comment: "hi",
      author: { id: 1, username: "me", secret: "x" },
      created: "2026-01-01T00:00:00Z",
      reactions: {},
    }),
    { id: 3, comment: "hi", author: "me", created: "2026-01-01T00:00:00Z" },
  );
  assert.deepEqual(commentSummary({ id: 4, comment: "x" }), {
    id: 4,
    comment: "x",
    author: null,
    created: null,
  });
});

test("tierAllowed filters a synthetic tool list by env flags", () => {
  const tools = [
    { name: "r", tier: "read" },
    { name: "a", tier: "additive" },
    { name: "w", tier: "write" },
    { name: "d", tier: "delete" },
  ];
  const names = (flags) => tools.filter((t) => tierAllowed(t.tier, flags)).map((t) => t.name);
  assert.deepEqual(names({ allowWrite: false, allowDelete: false }), ["r", "a"]);
  assert.deepEqual(names({ allowWrite: true, allowDelete: false }), ["r", "a", "w"]);
  assert.deepEqual(names({ allowWrite: false, allowDelete: true }), ["r", "a", "d"]);
  assert.deepEqual(names({ allowWrite: true, allowDelete: true }), ["r", "a", "w", "d"]);
});

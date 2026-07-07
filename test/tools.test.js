// Unit tests for the tool handlers in tools.js. buildTools() takes an injected
// api(), so every handler's validation, query building, and result shaping can
// be tested offline — no server, no network, no Vikunja.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTools } from "../tools.js";
import { tierAllowed } from "../lib.js";

const KNOWN_TIERS = new Set(["read", "additive", "write", "delete"]);
const headers = (obj) => new Headers(obj);
const noop = async () => ({ data: null, headers: headers() });
const byName = (tools, name) => tools.find((t) => t.name === name);

test("every tool declares a name, description, inputSchema, and known tier", () => {
  for (const t of buildTools({ api: noop })) {
    assert.equal(typeof t.name, "string");
    assert.equal(typeof t.description, "string");
    assert.equal(typeof t.inputSchema, "object");
    assert.ok(KNOWN_TIERS.has(t.tier), `${t.name} has tier "${t.tier}"`);
    assert.equal(typeof t.run, "function");
  }
});

test("each tool has the expected tier", () => {
  const tiers = Object.fromEntries(buildTools({ api: noop }).map((t) => [t.name, t.tier]));
  assert.deepEqual(tiers, {
    list_projects: "read",
    list_tasks: "read",
    list_all_tasks: "read",
    get_task: "read",
    get_project: "read",
    create_task: "additive",
    create_project: "additive",
    update_task: "write",
    set_task_done: "write",
    update_project: "write",
    archive_project: "write",
    delete_project: "delete",
    list_labels: "read",
    create_label: "additive",
    add_label_to_task: "additive",
    remove_label_from_task: "delete",
    search_users: "read",
    list_task_assignees: "read",
    assign_user: "additive",
    unassign_user: "delete",
    list_task_comments: "read",
    add_task_comment: "additive",
    delete_task_comment: "delete",
    list_task_relations: "read",
    create_task_relation: "additive",
    delete_task_relation: "delete",
    list_task_attachments: "read",
    upload_task_attachment: "additive",
    delete_task_attachment: "delete",
    list_buckets: "read",
    create_bucket: "additive",
    move_task_to_bucket: "write",
    list_teams: "read",
    create_team: "additive",
    share_project_with_user: "additive",
    share_project_with_team: "additive",
    create_link_share: "additive",
    list_saved_filters: "read",
    create_saved_filter: "additive",
    update_saved_filter: "write",
    delete_saved_filter: "delete",
    list_notifications: "read",
    mark_notification_read: "write",
    subscribe: "additive",
    unsubscribe: "delete",
    get_current_user: "read",
    list_api_tokens: "read",
    create_api_token: "write",
    list_webhooks: "read",
    create_webhook: "additive",
    delete_webhook: "delete",
  });
});

test("list_webhooks maps id/target_url/events into the paginated envelope", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/projects/4/webhooks");
    return {
      data: [{ id: 1, target_url: "https://x/hook", events: ["task.created"], secret: "s" }],
      headers: headers({ "x-pagination-total-pages": "1" }),
    };
  };
  const res = await byName(buildTools({ api }), "list_webhooks").run({ project_id: 4 });
  assert.deepEqual(res.items, [{ id: 1, target_url: "https://x/hook", events: ["task.created"] }]);
});

test("create_webhook validates url + events and PUTs them (+ optional secret)", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/4/webhooks");
    assert.deepEqual(body, {
      target_url: "https://example.com/hook",
      events: ["task.created"],
      secret: "sh",
    });
    return { data: { id: 8, target_url: "https://example.com/hook", events: ["task.created"] }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_webhook").run({
    project_id: 4,
    target_url: "https://example.com/hook",
    events: ["task.created"],
    secret: "sh",
  });
  assert.deepEqual(res, { id: 8, target_url: "https://example.com/hook", events: ["task.created"] });
});

test("create_webhook rejects a non-http url and empty events before the api call", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  const tools = buildTools({ api });
  await assert.rejects(
    () => byName(tools, "create_webhook").run({ project_id: 4, target_url: "ftp://x", events: ["task.created"] }),
    /http or https/,
  );
  await assert.rejects(
    () => byName(tools, "create_webhook").run({ project_id: 4, target_url: "https://x", events: [] }),
    /events must be/,
  );
  assert.equal(called, false);
});

test("delete_webhook DELETEs /projects/{id}/webhooks/{webhookId} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/projects/4/webhooks/8");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "delete_webhook").run({ project_id: 4, webhook_id: 8 });
  assert.deepEqual(res, { project_id: 4, webhook_id: 8, deleted: true });
});

test("get_current_user fetches /user and returns the user summary", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/user");
    return { data: { id: 1, username: "me", name: "Me", settings: {} }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "get_current_user").run({});
  assert.deepEqual(res, { id: 1, username: "me", name: "Me" });
});

test("list_api_tokens maps tokens into the paginated envelope (never the secret)", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/tokens");
    return {
      data: [{ id: 1, title: "CI", expires_at: "2027-01-01T00:00:00Z", permissions: { tasks: ["read_all"] }, token: "tk_x" }],
      headers: headers({ "x-pagination-total-pages": "1" }),
    };
  };
  const res = await byName(buildTools({ api }), "list_api_tokens").run({});
  assert.deepEqual(res.items, [
    { id: 1, title: "CI", expires_at: "2027-01-01T00:00:00Z", permissions: { tasks: ["read_all"] } },
  ]);
});

test("create_api_token PUTs title/permissions/expires_at and returns the token secret", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tokens");
    assert.deepEqual(body, {
      title: "CI",
      permissions: { tasks: ["read_all"] },
      expires_at: "2027-01-01T00:00:00.000Z",
    });
    return { data: { id: 5, title: "CI", token: "tk_secret", expires_at: "2027-01-01T00:00:00Z" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_api_token").run({
    title: " CI ",
    permissions: { tasks: ["read_all"] },
    expires_at: "2027-01-01T00:00:00Z",
  });
  assert.deepEqual(res, { id: 5, title: "CI", token: "tk_secret", expires_at: "2027-01-01T00:00:00Z" });
});

test("create_api_token rejects empty permissions before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "create_api_token").run({ title: "x", permissions: {}, expires_at: "2027-01-01T00:00:00Z" }),
    /permissions must be/,
  );
  assert.equal(called, false);
});

test("list_notifications maps into the paginated envelope", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/notifications");
    return {
      data: [{ id: 1, name: "task.assigned", read_at: "0001-01-01T00:00:00Z", created: "2026-01-01T00:00:00Z" }],
      headers: headers({ "x-pagination-total-pages": "1" }),
    };
  };
  const res = await byName(buildTools({ api }), "list_notifications").run({});
  assert.deepEqual(res.items, [{ id: 1, name: "task.assigned", read: false, created: "2026-01-01T00:00:00Z" }]);
});

test("mark_notification_read POSTs { read } (default true), can mark unread", async () => {
  const seen = [];
  const api = async (method, path, body) => {
    seen.push([method, path, body]);
    return { data: {}, headers: headers() };
  };
  const tools = buildTools({ api });
  assert.deepEqual(await byName(tools, "mark_notification_read").run({ notification_id: 3 }), {
    notification_id: 3,
    read: true,
    marked: true,
  });
  await byName(tools, "mark_notification_read").run({ notification_id: 3, read: false });
  assert.deepEqual(seen, [
    ["POST", "/notifications/3", { read: true }],
    ["POST", "/notifications/3", { read: false }],
  ]);
});

test("subscribe validates entity + id and PUTs the subscription", async () => {
  const api = async (method, path) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/subscriptions/task/7");
    return { data: { id: 1, entity: "task", entity_id: 7 }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "subscribe").run({ entity: "task", entity_id: 7 });
  assert.deepEqual(res, { entity: "task", entity_id: 7, subscribed: true });
});

test("subscribe rejects an unknown entity before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "subscribe").run({ entity: "label", entity_id: 7 }),
    /entity must be one of/,
  );
  assert.equal(called, false);
});

test("unsubscribe DELETEs /subscriptions/{entity}/{id} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/subscriptions/project/4");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "unsubscribe").run({ entity: "project", entity_id: 4 });
  assert.deepEqual(res, { entity: "project", entity_id: 4, unsubscribed: true });
});

test("list_saved_filters extracts negative-id projects and maps to filter ids", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/projects");
    return {
      data: [
        { id: 5, title: "Real project" },
        { id: -3, title: "F1" },
        { id: -4, title: "F2" },
      ],
      headers: headers(),
    };
  };
  const res = await byName(buildTools({ api }), "list_saved_filters").run({});
  // filter_id = -project_id - 1  →  -3 => 2, -4 => 3
  assert.deepEqual(res, { filters: [{ id: 2, title: "F1" }, { id: 3, title: "F2" }] });
});

test("create_saved_filter PUTs title + filter query (+ optional description)", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/filters");
    assert.deepEqual(body, { title: "Urgent", description: "d", filters: { filter: "priority >= 4" } });
    return { data: { id: 7, title: "Urgent" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_saved_filter").run({
    title: " Urgent ",
    description: "d",
    filter: "priority >= 4",
  });
  assert.deepEqual(res, { id: 7, title: "Urgent" });
});

test("update_saved_filter fetch-merges, preserving the rest of the filters object", async () => {
  const current = {
    id: 5,
    title: "Old",
    description: "keep",
    filters: { s: "", sort_by: null, order_by: null, filter: "done = false", filter_include_nulls: true },
    is_favorite: true,
  };
  let posted;
  const api = async (method, path, body) => {
    if (method === "GET") {
      assert.equal(path, "/filters/5");
      return { data: current, headers: headers() };
    }
    assert.equal(method, "POST");
    assert.equal(path, "/filters/5");
    posted = body;
    return { data: { ...current, title: body.title, filters: body.filters }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "update_saved_filter").run({ filter_id: 5, filter: "priority >= 3" });
  assert.deepEqual(posted, {
    title: "Old",
    description: "keep",
    filters: { s: "", sort_by: null, order_by: null, filter: "priority >= 3", filter_include_nulls: true },
    is_favorite: true,
  });
  assert.equal(res.filter, "priority >= 3");
});

test("create_saved_filter rejects an empty filter query before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "create_saved_filter").run({ title: "x", filter: "   " }),
    /filter must not be empty/,
  );
  assert.equal(called, false);
});

test("update_saved_filter rejects an empty filter with a clear error (not a no-op)", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "update_saved_filter").run({ filter_id: 5, filter: "" }),
    /filter must not be empty/,
  );
  assert.equal(called, false);
});

test("update_saved_filter errors (no api call) when nothing is provided", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "update_saved_filter").run({ filter_id: 5 }),
    /no fields to update/,
  );
  assert.equal(called, false);
});

test("delete_saved_filter DELETEs /filters/{id} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/filters/5");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "delete_saved_filter").run({ filter_id: 5 });
  assert.deepEqual(res, { id: 5, deleted: true });
});

test("list_teams maps id/name into the paginated envelope", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/teams");
    return { data: [{ id: 1, name: "Squad", extra: "drop" }], headers: headers({ "x-pagination-total-pages": "1" }) };
  };
  const res = await byName(buildTools({ api }), "list_teams").run({});
  assert.deepEqual(res.items, [{ id: 1, name: "Squad" }]);
});

test("create_team PUTs the name and returns id/name", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/teams");
    assert.deepEqual(body, { name: "Squad" });
    return { data: { id: 3, name: "Squad" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_team").run({ name: " Squad " });
  assert.deepEqual(res, { id: 3, name: "Squad" });
});

test("share_project_with_user PUTs { user_id, permission } (default read)", async () => {
  const seen = [];
  const api = async (method, path, body) => {
    seen.push([method, path, body]);
    return { data: { user_id: body.user_id, permission: body.permission }, headers: headers() };
  };
  const tools = buildTools({ api });
  const def = await byName(tools, "share_project_with_user").run({ project_id: 4, user_id: 9 });
  assert.deepEqual(def, { project_id: 4, user_id: 9, permission: 0, shared: true });
  const rw = await byName(tools, "share_project_with_user").run({ project_id: 4, user_id: 9, permission: 1 });
  assert.equal(rw.permission, 1);
  assert.deepEqual(seen, [
    ["PUT", "/projects/4/users", { user_id: 9, permission: 0 }],
    ["PUT", "/projects/4/users", { user_id: 9, permission: 1 }],
  ]);
});

test("share_project_with_team PUTs { team_id, permission }", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/4/teams");
    assert.deepEqual(body, { team_id: 2, permission: 2 });
    return { data: { team_id: 2, permission: 2 }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "share_project_with_team").run({ project_id: 4, team_id: 2, permission: 2 });
  assert.deepEqual(res, { project_id: 4, team_id: 2, permission: 2, shared: true });
});

test("create_link_share PUTs { permission } and returns the hash", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/4/shares");
    assert.deepEqual(body, { permission: 0 });
    return { data: { id: 1, hash: "abc123", permission: 0 }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_link_share").run({ project_id: 4 });
  assert.deepEqual(res, { project_id: 4, hash: "abc123", permission: 0 });
});

test("share tools reject an invalid permission before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "share_project_with_team").run({ project_id: 4, team_id: 2, permission: 5 }),
    /permission must be/,
  );
  assert.equal(called, false);
});

// Buckets live under a project's kanban view; the tools auto-resolve it.
function kanbanApi(handler) {
  return async (method, path, body) => {
    if (method === "GET" && path === "/projects/5/views") {
      return { data: [{ id: 1, view_kind: "list" }, { id: 9, view_kind: "kanban" }], headers: new Headers() };
    }
    return handler(method, path, body);
  };
}

test("list_buckets resolves the kanban view and lists its buckets", async () => {
  const api = kanbanApi(async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/projects/5/views/9/buckets");
    return { data: [{ id: 1, title: "To-Do", limit: 0, count: 2 }], headers: new Headers() };
  });
  const res = await byName(buildTools({ api }), "list_buckets").run({ project_id: 5 });
  assert.deepEqual(res, {
    project_id: 5,
    view_id: 9,
    buckets: [{ id: 1, title: "To-Do", limit: 0, count: 2 }],
  });
});

test("create_bucket PUTs the title under the kanban view", async () => {
  const api = kanbanApi(async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/5/views/9/buckets");
    assert.deepEqual(body, { title: "Doing" });
    return { data: { id: 12, title: "Doing" }, headers: new Headers() };
  });
  const res = await byName(buildTools({ api }), "create_bucket").run({ project_id: 5, title: " Doing " });
  assert.deepEqual(res, { id: 12, title: "Doing", view_id: 9 });
});

test("move_task_to_bucket POSTs { task_id } to the bucket's tasks endpoint", async () => {
  const api = kanbanApi(async (method, path, body) => {
    assert.equal(method, "POST");
    assert.equal(path, "/projects/5/views/9/buckets/2/tasks");
    assert.deepEqual(body, { task_id: 7 });
    return { data: { bucket_id: 2, task_id: 7 }, headers: new Headers() };
  });
  const res = await byName(buildTools({ api }), "move_task_to_bucket").run({ project_id: 5, bucket_id: 2, task_id: 7 });
  assert.deepEqual(res, { project_id: 5, view_id: 9, bucket_id: 2, task_id: 7, moved: true });
});

test("bucket tools resolve the FIRST kanban view when several exist", async () => {
  const api = async (method, path) => {
    if (path === "/projects/5/views") {
      return {
        data: [
          { id: 1, view_kind: "list" },
          { id: 4, view_kind: "kanban" },
          { id: 7, view_kind: "kanban" },
        ],
        headers: new Headers(),
      };
    }
    assert.equal(path, "/projects/5/views/4/buckets", "uses the first kanban view (id 4)");
    return { data: [], headers: new Headers() };
  };
  const res = await byName(buildTools({ api }), "list_buckets").run({ project_id: 5 });
  assert.equal(res.view_id, 4);
});

test("bucket tools error when the project has no kanban view", async () => {
  const api = async (method, path) => {
    if (path === "/projects/5/views") return { data: [{ id: 1, view_kind: "list" }], headers: new Headers() };
    throw new Error("should not reach the bucket endpoint");
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "list_buckets").run({ project_id: 5 }),
    /no kanban view/,
  );
});

test("list_task_attachments maps attachments into the paginated envelope", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/tasks/7/attachments");
    return {
      data: [{ id: 1, file: { name: "a.txt", size: 3, mime: "text/plain" }, created: "2026-01-01T00:00:00Z" }],
      headers: headers({ "x-pagination-total-pages": "1" }),
    };
  };
  const res = await byName(buildTools({ api }), "list_task_attachments").run({ task_id: 7 });
  assert.deepEqual(res.items, [
    { id: 1, name: "a.txt", size: 3, mime: "text/plain", created: "2026-01-01T00:00:00Z" },
  ]);
});

test("upload_task_attachment builds multipart with the decoded file and returns summaries", async () => {
  const content = Buffer.from("hello attachment").toString("base64");
  let seenForm;
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tasks/7/attachments");
    seenForm = body;
    return {
      data: { success: [{ id: 9, file: { name: "note.txt", size: 16, mime: "text/plain" }, created: null }] },
      headers: headers(),
    };
  };
  const res = await byName(buildTools({ api }), "upload_task_attachment").run({
    task_id: 7,
    filename: "note.txt",
    content_base64: content,
  });
  assert.ok(seenForm instanceof FormData, "body should be FormData");
  const file = seenForm.get("files");
  assert.equal(file.name, "note.txt");
  assert.equal(await file.text(), "hello attachment");
  assert.deepEqual(res, {
    task_id: 7,
    uploaded: [{ id: 9, name: "note.txt", size: 16, mime: "text/plain", created: null }],
  });
});

test("upload_task_attachment rejects bad base64 before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: { success: [] }, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "upload_task_attachment").run({ task_id: 7, filename: "x", content_base64: "!!!" }),
    /base64/,
  );
  assert.equal(called, false);
});

test("upload_task_attachment surfaces a 200-with-errors as a failure", async () => {
  const content = Buffer.from("x").toString("base64");
  const api = async () => ({
    data: { success: [], errors: [{ message: "file too large" }] },
    headers: headers(),
  });
  await assert.rejects(
    () => byName(buildTools({ api }), "upload_task_attachment").run({ task_id: 7, filename: "x", content_base64: content }),
    /upload failed/,
  );
});

test("delete_task_attachment DELETEs /tasks/{id}/attachments/{attachmentId} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/tasks/7/attachments/9");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "delete_task_attachment").run({ task_id: 7, attachment_id: 9 });
  assert.deepEqual(res, { task_id: 7, attachment_id: 9, deleted: true });
});

test("list_task_relations derives related_tasks from GET /tasks/{id} and shapes them", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/tasks/7");
    return {
      data: { id: 7, related_tasks: { related: [{ id: 8, title: "B", done: false, extra: "drop" }] } },
      headers: headers(),
    };
  };
  const res = await byName(buildTools({ api }), "list_task_relations").run({ task_id: 7 });
  assert.deepEqual(res, { task_id: 7, relations: { related: [{ id: 8, title: "B", done: false }] } });
});

test("create_task_relation validates kind + ids and PUTs the relation", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tasks/7/relations");
    assert.deepEqual(body, { other_task_id: 8, relation_kind: "blocking" });
    return { data: { task_id: 7, other_task_id: 8, relation_kind: "blocking" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_task_relation").run({
    task_id: 7,
    other_task_id: 8,
    relation_kind: "blocking",
  });
  assert.deepEqual(res, { task_id: 7, other_task_id: 8, relation_kind: "blocking", created: true });
});

test("create_task_relation rejects an unknown relation_kind before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "create_task_relation").run({ task_id: 7, other_task_id: 8, relation_kind: "friend" }),
    /relation_kind must be one of/,
  );
  assert.equal(called, false);
});

test("create_task_relation names other_task_id in its validation error", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "create_task_relation").run({ task_id: 7, other_task_id: -1, relation_kind: "related" }),
    /other_task_id must be a positive integer/,
  );
  assert.equal(called, false);
});

test("delete_task_relation DELETEs /tasks/{id}/relations/{kind}/{otherId} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/tasks/7/relations/related/8");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "delete_task_relation").run({
    task_id: 7,
    other_task_id: 8,
    relation_kind: "related",
  });
  assert.deepEqual(res, { task_id: 7, other_task_id: 8, relation_kind: "related", deleted: true });
});

test("list_task_comments maps comments into the paginated envelope", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/tasks/7/comments?per_page=20");
    return {
      data: [{ id: 1, comment: "hi", author: { username: "me" }, created: "2026-01-01T00:00:00Z" }],
      headers: headers({ "x-pagination-total-pages": "1" }),
    };
  };
  const res = await byName(buildTools({ api }), "list_task_comments").run({ task_id: 7, per_page: 20 });
  assert.deepEqual(res.items, [{ id: 1, comment: "hi", author: "me", created: "2026-01-01T00:00:00Z" }]);
});

test("add_task_comment validates and PUTs { comment }, returns the summary", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tasks/7/comments");
    assert.deepEqual(body, { comment: "hello" });
    return { data: { id: 9, comment: "hello", author: { username: "me" } }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "add_task_comment").run({ task_id: 7, comment: "  hello  " });
  assert.deepEqual(res, { id: 9, comment: "hello", author: "me", created: null });
});

test("add_task_comment rejects an empty comment before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "add_task_comment").run({ task_id: 7, comment: "   " }),
    /comment must not be empty/,
  );
  assert.equal(called, false);
});

test("delete_task_comment DELETEs /tasks/{id}/comments/{commentId} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/tasks/7/comments/9");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "delete_task_comment").run({ task_id: 7, comment_id: 9 });
  assert.deepEqual(res, { task_id: 7, comment_id: 9, deleted: true });
});

test("search_users hits /users?s= and maps id/username/name; null → []", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/users?s=mc");
    return { data: [{ id: 1, username: "mctester", name: "MC", extra: "drop" }], headers: headers() };
  };
  const res = await byName(buildTools({ api }), "search_users").run({ query: " mc " });
  assert.deepEqual(res, { users: [{ id: 1, username: "mctester", name: "MC" }] });

  const apiNull = async () => ({ data: null, headers: headers() });
  const empty = await byName(buildTools({ api: apiNull }), "search_users").run({ query: "zzz" });
  assert.deepEqual(empty, { users: [] });
});

test("search_users rejects an empty query before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: [], headers: headers() };
  };
  await assert.rejects(() => byName(buildTools({ api }), "search_users").run({ query: "  " }), /query/);
  assert.equal(called, false);
});

test("list_task_assignees derives assignees from GET /tasks/{id} (the list endpoint is broken)", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/tasks/7");
    return {
      data: { id: 7, assignees: [{ id: 1, username: "me", name: "" }] },
      headers: headers(),
    };
  };
  const res = await byName(buildTools({ api }), "list_task_assignees").run({ task_id: 7 });
  assert.deepEqual(res, { task_id: 7, assignees: [{ id: 1, username: "me", name: "" }] });
});

test("assign_user PUTs { user_id } and confirms", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tasks/7/assignees");
    assert.deepEqual(body, { user_id: 3 });
    return { data: { user_id: 3 }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "assign_user").run({ task_id: 7, user_id: 3 });
  assert.deepEqual(res, { task_id: 7, user_id: 3, assigned: true });
});

test("unassign_user DELETEs /tasks/{id}/assignees/{userId} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/tasks/7/assignees/3");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "unassign_user").run({ task_id: 7, user_id: 3 });
  assert.deepEqual(res, { task_id: 7, user_id: 3, unassigned: true });
});

test("list_labels maps id/title/hex_color into the paginated envelope", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/labels?per_page=50");
    return {
      data: [{ id: 1, title: "urgent", hex_color: "ff0000", extra: "drop" }],
      headers: headers({ "x-pagination-total-pages": "1" }),
    };
  };
  const res = await byName(buildTools({ api }), "list_labels").run({ per_page: 50 });
  assert.deepEqual(res.items, [{ id: 1, title: "urgent", hex_color: "ff0000" }]);
});

test("create_label PUTs title + optional hex_color and returns the summary", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/labels");
    assert.deepEqual(body, { title: "urgent", hex_color: "ff0000" });
    return { data: { id: 5, title: "urgent", hex_color: "ff0000" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_label").run({ title: " urgent ", hex_color: "#FF0000" });
  assert.deepEqual(res, { id: 5, title: "urgent", hex_color: "ff0000" });
});

test("add_label_to_task validates ids and PUTs { label_id }", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tasks/7/labels");
    assert.deepEqual(body, { label_id: 3 });
    return { data: { label_id: 3 }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "add_label_to_task").run({ task_id: 7, label_id: 3 });
  assert.deepEqual(res, { task_id: 7, label_id: 3, added: true });
});

test("add_label_to_task rejects a bad label_id before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "add_label_to_task").run({ task_id: 7, label_id: 0 }),
    /label_id must be a positive integer/,
  );
  assert.equal(called, false);
});

test("remove_label_from_task DELETEs /tasks/{id}/labels/{labelId} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/tasks/7/labels/3");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "remove_label_from_task").run({ task_id: 7, label_id: 3 });
  assert.deepEqual(res, { task_id: 7, label_id: 3, removed: true });
});

test("get_project validates id, fetches /projects/{id}, shapes the detail", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/projects/4");
    return { data: { id: 4, title: "Work", parent_project_id: 0, is_archived: false }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "get_project").run({ project_id: 4 });
  assert.equal(res.id, 4);
  assert.equal(res.parent_project_id, null);
});

test("create_project PUTs title + optional description/parent and returns id/title", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects");
    assert.deepEqual(body, { title: "New", description: "d", parent_project_id: 2 });
    return { data: { id: 8, title: "New" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_project").run({
    title: "  New  ",
    description: "d",
    parent_project_id: 2,
  });
  assert.deepEqual(res, { id: 8, title: "New" });
});

test("update_project fetch-merges current fields, overriding only the change", async () => {
  const current = {
    id: 4,
    title: "Old",
    description: "keep",
    identifier: "OLD",
    hex_color: "abc123",
    parent_project_id: 2,
    is_archived: false,
    is_favorite: true,
  };
  let posted;
  const api = async (method, path, body) => {
    if (method === "GET") {
      assert.equal(path, "/projects/4");
      return { data: current, headers: headers() };
    }
    assert.equal(method, "POST");
    assert.equal(path, "/projects/4");
    posted = body;
    return { data: { ...current, ...body }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "update_project").run({ project_id: 4, title: "Renamed" });
  // title overridden; every other editable field preserved (no clobber)
  assert.deepEqual(posted, {
    title: "Renamed",
    description: "keep",
    identifier: "OLD",
    hex_color: "abc123",
    parent_project_id: 2,
    is_archived: false,
    is_favorite: true,
  });
  assert.equal(res.title, "Renamed");
});

test("update_project errors (without any api call) when no field is given", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "update_project").run({ project_id: 4 }),
    /no fields to update/,
  );
  assert.equal(called, false, "must not even fetch when there is nothing to update");
});

test("archive_project fetch-merges and toggles is_archived, preserving the title", async () => {
  const current = { id: 4, title: "P", description: "", parent_project_id: 0, is_archived: false };
  const posted = [];
  const api = async (method, path, body) => {
    if (method === "GET") return { data: current, headers: headers() };
    posted.push(body);
    return { data: { ...current, is_archived: body.is_archived }, headers: headers() };
  };
  const tools = buildTools({ api });
  assert.equal((await byName(tools, "archive_project").run({ project_id: 4 })).is_archived, true);
  assert.equal((await byName(tools, "archive_project").run({ project_id: 4, archived: false })).is_archived, false);
  assert.equal(posted[0].title, "P", "title carried through so Vikunja's non-empty check passes");
  assert.equal(posted[0].is_archived, true);
  assert.equal(posted[1].is_archived, false);
});

test("delete_project DELETEs and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/projects/4");
    return { data: { message: "Successfully deleted." }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "delete_project").run({ project_id: 4 });
  assert.deepEqual(res, { id: 4, deleted: true });
});

test("delete_project validates id before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "delete_project").run({ project_id: 0 }),
    /positive integer/,
  );
  assert.equal(called, false);
});

test("get_task validates the id, fetches /tasks/{id}, and shapes the detail", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/tasks/42");
    return {
      data: { id: 42, title: "T", done: false, project_id: 3, due_date: "0001-01-01T00:00:00Z" },
      headers: headers(),
    };
  };
  const res = await byName(buildTools({ api }), "get_task").run({ task_id: 42 });
  assert.equal(res.id, 42);
  assert.equal(res.due_date, null, "zero-date normalized");
});

test("get_task errors when Vikunja returns an empty/malformed body", async () => {
  const api = async () => ({ data: null, headers: headers() });
  await assert.rejects(() => byName(buildTools({ api }), "get_task").run({ task_id: 5 }), /no task/);
});

test("get_task rejects a bad id before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(() => byName(buildTools({ api }), "get_task").run({ task_id: 0 }), /positive integer/);
  assert.equal(called, false);
});

test("list_tasks forwards filter/sort_by/order_by alongside pagination", async () => {
  let seenPath;
  const api = async (_m, path) => {
    seenPath = path;
    return { data: [], headers: headers() };
  };
  await byName(buildTools({ api }), "list_tasks").run({
    project_id: 3,
    filter: "done = false",
    sort_by: "priority",
    order_by: "desc",
    page: 2,
  });
  assert.equal(seenPath, "/projects/3/tasks?filter=done+%3D+false&sort_by=priority&order_by=desc&page=2");
});

test("list_all_tasks hits /tasks with filter/sort and maps id/title/done/project_id", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/tasks?filter=priority+%3E%3D+3&sort_by=due_date&order_by=asc");
    return {
      data: [{ id: 5, title: "A", done: false, project_id: 2, extra: "drop" }],
      headers: headers({ "x-pagination-total-pages": "1" }),
    };
  };
  const res = await byName(buildTools({ api }), "list_all_tasks").run({
    filter: "priority >= 3",
    sort_by: "due_date",
    order_by: "asc",
  });
  assert.deepEqual(res.items, [{ id: 5, title: "A", done: false, project_id: 2 }]);
  assert.equal(res.total_pages, 1);
});

test("list_all_tasks rejects an invalid order_by before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: [], headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "list_all_tasks").run({ order_by: "up" }),
    /asc.*desc/,
  );
  assert.equal(called, false);
});

test("the real registration filter gates write/delete tiers behind their flags", () => {
  // Mirrors index.js exactly: buildTools(...).filter(t => tierAllowed(t.tier, gate)).
  // buildTools ships only read/additive today, so inject synthetic gated tools
  // to prove the filter drops them by default and admits them per-flag.
  const registry = [
    ...buildTools({ api: noop }),
    { name: "synthetic_write", tier: "write" },
    { name: "synthetic_delete", tier: "delete" },
  ];
  const exposed = (gate) => registry.filter((t) => tierAllowed(t.tier, gate)).map((t) => t.name);

  const defaultSet = exposed({ allowWrite: false, allowDelete: false });
  assert.ok(!defaultSet.includes("synthetic_write"), "write gated by default");
  assert.ok(!defaultSet.includes("synthetic_delete"), "delete gated by default");
  // every real default tool is read/additive
  for (const t of buildTools({ api: noop })) {
    if (t.tier === "read" || t.tier === "additive") {
      assert.ok(defaultSet.includes(t.name), `${t.name} exposed by default`);
    } else {
      assert.ok(!defaultSet.includes(t.name), `${t.name} gated by default`);
    }
  }
  assert.ok(exposed({ allowWrite: true, allowDelete: false }).includes("synthetic_write"));
  assert.ok(!exposed({ allowWrite: true, allowDelete: false }).includes("synthetic_delete"));
  assert.ok(exposed({ allowWrite: false, allowDelete: true }).includes("synthetic_delete"));
  assert.ok(!exposed({ allowWrite: false, allowDelete: true }).includes("synthetic_write"));
});

test("list_projects maps items and shapes the paginated envelope from headers", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/projects");
    return {
      data: [{ id: 1, title: "A", extra: "drop" }, { id: 2, title: "B" }],
      headers: headers({ "x-pagination-total-pages": "3" }),
    };
  };
  const res = await byName(buildTools({ api }), "list_projects").run({});
  assert.deepEqual(res, {
    page: 1,
    total_pages: 3,
    count: 2,
    items: [{ id: 1, title: "A" }, { id: 2, title: "B" }],
  });
});

test("list_projects forwards page/per_page as a query string", async () => {
  let seenPath;
  const api = async (_m, path) => {
    seenPath = path;
    return { data: [], headers: headers() };
  };
  await byName(buildTools({ api }), "list_projects").run({ page: 2, per_page: 10 });
  assert.equal(seenPath, "/projects?page=2&per_page=10");
});

test("list_tasks validates project_id before touching the network", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: [], headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "list_tasks").run({ project_id: -1 }),
    /positive integer/,
  );
  assert.equal(called, false, "api must not be called on invalid input");
});

test("list_tasks maps tasks under the validated project path", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/projects/7/tasks");
    return {
      data: [{ id: 42, title: "T", done: false, extra: "drop" }],
      headers: headers({ "x-pagination-total-pages": "1" }),
    };
  };
  const res = await byName(buildTools({ api }), "list_tasks").run({ project_id: 7 });
  assert.deepEqual(res.items, [{ id: 42, title: "T", done: false }]);
});

test("create_task trims the title, PUTs it, and returns id/title", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/5/tasks");
    assert.deepEqual(body, { title: "Hello" });
    return { data: { id: 9, title: "Hello" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_task").run({ project_id: 5, title: "  Hello  " });
  assert.deepEqual(res, { id: 9, title: "Hello" });
});

test("create_task includes optional description/due_date/priority in the body", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/5/tasks");
    assert.deepEqual(body, {
      title: "Hello",
      description: "d",
      due_date: "2026-08-01T00:00:00.000Z",
      priority: 4,
    });
    return { data: { id: 9, title: "Hello" }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "create_task").run({
    project_id: 5,
    title: "Hello",
    description: "d",
    due_date: "2026-08-01",
    priority: 4,
  });
  assert.deepEqual(res, { id: 9, title: "Hello" });
});

test("update_task POSTs only the provided fields and returns the shaped detail", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "POST");
    assert.equal(path, "/tasks/12");
    assert.deepEqual(body, { priority: 5, done: true });
    return { data: { id: 12, title: "T", done: true, project_id: 1, priority: 5 }, headers: headers() };
  };
  const res = await byName(buildTools({ api }), "update_task").run({ task_id: 12, priority: 5, done: true });
  assert.equal(res.id, 12);
  assert.equal(res.done, true);
  assert.equal(res.priority, 5);
});

test("update_task rejects when no updatable field is supplied", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "update_task").run({ task_id: 12 }),
    /no fields to update/,
  );
  assert.equal(called, false);
});

test("update_task validates task_id before touching the network", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "update_task").run({ task_id: -1, done: true }),
    /positive integer/,
  );
  assert.equal(called, false);
});

test("set_task_done defaults to done=true and can reopen with done=false", async () => {
  const seen = [];
  const api = async (method, path, body) => {
    seen.push([method, path, body]);
    return { data: { id: 3, title: "T", done: body.done, project_id: 1 }, headers: headers() };
  };
  const tools = buildTools({ api });
  const doneRes = await byName(tools, "set_task_done").run({ task_id: 3 });
  assert.equal(doneRes.done, true);
  const openRes = await byName(tools, "set_task_done").run({ task_id: 3, done: false });
  assert.equal(openRes.done, false);
  assert.deepEqual(seen, [
    ["POST", "/tasks/3", { done: true }],
    ["POST", "/tasks/3", { done: false }],
  ]);
});

test("create_task rejects an empty title before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: { id: 1 }, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api }), "create_task").run({ project_id: 5, title: "   " }),
    /must not be empty/,
  );
  assert.equal(called, false);
});

test("create_task surfaces an empty Vikunja response as an error", async () => {
  const api = async () => ({ data: null, headers: headers() });
  await assert.rejects(
    () => byName(buildTools({ api }), "create_task").run({ project_id: 5, title: "x" }),
    /empty task response/,
  );
});

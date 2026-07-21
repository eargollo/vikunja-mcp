// Unit tests for the tool handlers in tools.js. buildTools() takes an injected
// api(), so every handler's validation, query building, and result shaping can
// be tested offline — no server, no network, no Vikunja.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTools } from "../tools.js";
import { tierAllowed, toolDisplayTitle } from "../lib.js";

const TEST_BASE = "http://vikunja.test/api/v1";
const KNOWN_TIERS = new Set(["read", "additive", "write", "delete"]);
const headers = (obj) => new Headers(obj);
const noop = async () => ({ data: null, headers: headers() });
const byName = (tools, name) => tools.find((t) => t.name === name);

test("every tool declares a name, description, inputSchema, and known tier", () => {
  for (const t of buildTools({ api: noop, base: TEST_BASE })) {
    assert.equal(typeof t.name, "string");
    assert.equal(typeof t.description, "string");
    assert.equal(typeof t.inputSchema, "object");
    assert.ok(KNOWN_TIERS.has(t.tier), `${t.name} has tier "${t.tier}"`);
    assert.equal(typeof t.run, "function");
  }
});

test("toolDisplayTitle yields a clean Title Case name for every shipped tool", () => {
  for (const t of buildTools({ api: noop, base: TEST_BASE })) {
    const title = toolDisplayTitle(t.name);
    assert.ok(title.length > 0, `${t.name} should get a non-empty title`);
    assert.ok(/^[A-Z]/.test(title), `${t.name} title should start upper-cased`);
    assert.ok(!/ {2,}|^ | $/.test(title), `${t.name} title should have no doubled/edge spaces`);
  }
});

test("integer-typed id and value schema fields never use type:number", () => {
  const seen = JSON.stringify(buildTools({ api: noop, base: TEST_BASE }).map((t) => t.inputSchema));
  assert.ok(!seen.includes('"type":"number"'), "no schema property should be typed 'number'");
});

test("each tool has the expected tier", () => {
  const tiers = Object.fromEntries(buildTools({ api: noop, base: TEST_BASE }).map((t) => [t.name, t.tier]));
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
    delete_task: "delete",
    bulk_update_tasks: "write",
    set_task_labels: "write",
    set_task_assignees: "write",
    update_project: "write",
    archive_project: "write",
    delete_project: "delete",
    list_labels: "read",
    create_label: "additive",
    update_label: "write",
    delete_label: "delete",
    add_label_to_task: "additive",
    remove_label_from_task: "delete",
    search_users: "read",
    list_task_assignees: "read",
    assign_user: "additive",
    unassign_user: "delete",
    list_task_comments: "read",
    add_task_comment: "additive",
    update_task_comment: "write",
    delete_task_comment: "delete",
    list_task_relations: "read",
    create_task_relation: "additive",
    delete_task_relation: "delete",
    list_task_attachments: "read",
    upload_task_attachment: "additive",
    delete_task_attachment: "delete",
    list_buckets: "read",
    create_bucket: "additive",
    update_bucket: "write",
    delete_bucket: "delete",
    move_task_to_bucket: "write",
    list_teams: "read",
    get_team: "read",
    create_team: "additive",
    update_team: "write",
    add_team_member: "additive",
    remove_team_member: "delete",
    toggle_team_member_admin: "write",
    share_project_with_user: "write",
    share_project_with_team: "write",
    create_link_share: "write",
    list_saved_filters: "read",
    create_saved_filter: "additive",
    update_saved_filter: "write",
    delete_saved_filter: "delete",
    list_notifications: "read",
    mark_notification_read: "write",
    subscribe: "additive",
    unsubscribe: "delete",
    get_current_user: "read",
    get_caldav_info: "read",
    list_api_tokens: "read",
    create_api_token: "write",
    create_caldav_token: "write",
    delete_caldav_token: "delete",
    list_webhooks: "read",
    create_webhook: "write",
    update_webhook: "write",
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_webhooks").run({ project_id: 4 });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_webhook").run({
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
  const tools = buildTools({ api, base: TEST_BASE });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "delete_webhook").run({ project_id: 4, webhook_id: 8 });
  assert.deepEqual(res, { ok: true, project_id: 4, webhook_id: 8 });
});

test("get_current_user fetches /user and returns the user summary", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/user");
    return { data: { id: 1, username: "me", name: "Me", settings: {} }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "get_current_user").run({});
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_api_tokens").run({});
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_api_token").run({
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
    () => byName(buildTools({ api, base: TEST_BASE }), "create_api_token").run({ title: "x", permissions: {}, expires_at: "2027-01-01T00:00:00Z" }),
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_notifications").run({});
  assert.deepEqual(res.items, [{ id: 1, name: "task.assigned", read: false, created: "2026-01-01T00:00:00Z" }]);
});

test("mark_notification_read POSTs { read } (default true), can mark unread", async () => {
  const seen = [];
  const api = async (method, path, body) => {
    seen.push([method, path, body]);
    return { data: {}, headers: headers() };
  };
  const tools = buildTools({ api, base: TEST_BASE });
  assert.deepEqual(await byName(tools, "mark_notification_read").run({ notification_id: 3 }), {
    ok: true,
    notification_id: 3,
    read: true,
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "subscribe").run({ entity: "task", entity_id: 7 });
  assert.deepEqual(res, { ok: true, entity: "task", entity_id: 7 });
});

test("subscribe rejects an unknown entity before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "subscribe").run({ entity: "label", entity_id: 7 }),
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "unsubscribe").run({ entity: "project", entity_id: 4 });
  assert.deepEqual(res, { ok: true, entity: "project", entity_id: 4 });
});

test("list_saved_filters pages through all projects and maps negative ids to filter ids", async () => {
  // Two pages of projects; the saved filters (negative ids) are split across
  // them, so a single-page read would miss F2. Assert both are found.
  const pages = {
    "/projects?page=1": {
      data: [{ id: 5, title: "Real project" }, { id: -3, title: "F1" }],
      headers: headers({ "x-pagination-total-pages": "2" }),
    },
    "/projects?page=2": {
      data: [{ id: 7, title: "Another" }, { id: -4, title: "F2" }],
      headers: headers({ "x-pagination-total-pages": "2" }),
    },
  };
  const seen = [];
  const api = async (method, path) => {
    assert.equal(method, "GET");
    seen.push(path);
    return pages[path];
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_saved_filters").run({});
  assert.deepEqual(seen, ["/projects?page=1", "/projects?page=2"]);
  // filter_id = -project_id - 1  →  -3 => 2, -4 => 3
  assert.deepEqual(res, { count: 2, items: [{ id: 2, title: "F1" }, { id: 3, title: "F2" }] });
});

test("create_saved_filter PUTs title + filter query (+ optional description)", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/filters");
    assert.deepEqual(body, { title: "Urgent", description: "d", filters: { filter: "priority >= 4" } });
    return { data: { id: 7, title: "Urgent", description: "d", filters: { filter: "priority >= 4" } }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_saved_filter").run({
    title: " Urgent ",
    description: "d",
    filter: "priority >= 4",
  });
  assert.deepEqual(res, { id: 7, title: "Urgent", description: "d", filter: "priority >= 4" });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "update_saved_filter").run({ filter_id: 5, filter: "priority >= 3" });
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
    () => byName(buildTools({ api, base: TEST_BASE }), "create_saved_filter").run({ title: "x", filter: "   " }),
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
    () => byName(buildTools({ api, base: TEST_BASE }), "update_saved_filter").run({ filter_id: 5, filter: "" }),
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
    () => byName(buildTools({ api, base: TEST_BASE }), "update_saved_filter").run({ filter_id: 5 }),
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "delete_saved_filter").run({ filter_id: 5 });
  assert.deepEqual(res, { ok: true, filter_id: 5 });
});

test("list_teams maps id/name into the paginated envelope", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/teams");
    return { data: [{ id: 1, name: "Squad", extra: "drop" }], headers: headers({ "x-pagination-total-pages": "1" }) };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_teams").run({});
  assert.deepEqual(res.items, [{ id: 1, name: "Squad" }]);
});

test("create_team PUTs the name and returns id/name", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/teams");
    assert.deepEqual(body, { name: "Squad" });
    return { data: { id: 3, name: "Squad" }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_team").run({ name: " Squad " });
  assert.deepEqual(res, { id: 3, name: "Squad" });
});

test("share_project_with_user PUTs { username, permission } (default read)", async () => {
  // The endpoint is keyed on username — ProjectUser.UserID is json:"-", so a
  // numeric user_id in the body is ignored and 404s. Assert the wire shape.
  const seen = [];
  const api = async (method, path, body) => {
    seen.push([method, path, body]);
    return { data: { username: body.username, permission: body.permission }, headers: headers() };
  };
  const tools = buildTools({ api, base: TEST_BASE });
  const def = await byName(tools, "share_project_with_user").run({ project_id: 4, username: "bob" });
  assert.deepEqual(def, { ok: true, project_id: 4, username: "bob", permission: 0 });
  const rw = await byName(tools, "share_project_with_user").run({ project_id: 4, username: "bob", permission: 1 });
  assert.equal(rw.permission, 1);
  assert.deepEqual(seen, [
    ["PUT", "/projects/4/users", { username: "bob", permission: 0 }],
    ["PUT", "/projects/4/users", { username: "bob", permission: 1 }],
  ]);
});

test("share_project_with_team PUTs { team_id, permission }", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/4/teams");
    assert.deepEqual(body, { team_id: 2, permission: 2 });
    return { data: { team_id: 2, permission: 2 }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "share_project_with_team").run({ project_id: 4, team_id: 2, permission: 2 });
  assert.deepEqual(res, { ok: true, project_id: 4, team_id: 2, permission: 2 });
});

test("create_link_share PUTs { permission } and returns the hash", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/4/shares");
    assert.deepEqual(body, { permission: 0 });
    return { data: { id: 1, hash: "abc123", permission: 0 }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_link_share").run({ project_id: 4 });
  assert.deepEqual(res, { project_id: 4, hash: "abc123", permission: 0 });
});

test("share tools reject an invalid permission before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "share_project_with_team").run({ project_id: 4, team_id: 2, permission: 5 }),
    /permission must be/,
  );
  assert.equal(called, false);
});

// The three share tools report `data?.permission ?? perm` — the permission
// Vikunja actually set, falling back to the requested one only when the server
// doesn't echo it. That exists so a silent server-side downgrade (grant less
// than asked) is visible to the caller. These lock that in: without them,
// replacing the expression with a plain `perm` passes every other test.
test("share_project_with_user reports the granted permission, not the requested one (downgrade visible)", async () => {
  const api = async (method, path, body) => {
    assert.deepEqual([method, path], ["PUT", "/projects/4/users"]);
    assert.equal(body.permission, 1, "requested read+write");
    return { data: { username: body.username, permission: 0 }, headers: headers() }; // server grants only read
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "share_project_with_user").run({ project_id: 4, username: "bob", permission: 1 });
  assert.deepEqual(res, { ok: true, project_id: 4, username: "bob", permission: 0 });
});

test("share_project_with_user falls back to the requested permission when Vikunja omits it", async () => {
  const api = async () => ({ data: { username: "bob" }, headers: headers() }); // no permission echoed
  const res = await byName(buildTools({ api, base: TEST_BASE }), "share_project_with_user").run({ project_id: 4, username: "bob", permission: 2 });
  assert.equal(res.permission, 2);
});

test("share_project_with_team reports the granted permission, not the requested one (downgrade visible)", async () => {
  const api = async (method, path, body) => {
    assert.deepEqual([method, path], ["PUT", "/projects/4/teams"]);
    assert.equal(body.permission, 2, "requested admin");
    return { data: { team_id: body.team_id, permission: 1 }, headers: headers() }; // server grants read+write
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "share_project_with_team").run({ project_id: 4, team_id: 2, permission: 2 });
  assert.deepEqual(res, { ok: true, project_id: 4, team_id: 2, permission: 1 });
});

test("share_project_with_team falls back to the requested permission when Vikunja omits it", async () => {
  const api = async () => ({ data: { team_id: 2 }, headers: headers() }); // no permission echoed
  const res = await byName(buildTools({ api, base: TEST_BASE }), "share_project_with_team").run({ project_id: 4, team_id: 2, permission: 1 });
  assert.equal(res.permission, 1);
});

test("create_link_share reports the granted permission, not the requested one (downgrade visible)", async () => {
  const api = async (method, path, body) => {
    assert.deepEqual([method, path], ["PUT", "/projects/4/shares"]);
    assert.equal(body.permission, 2, "requested admin");
    return { data: { id: 1, hash: "abc123", permission: 0 }, headers: headers() }; // server grants only read
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_link_share").run({ project_id: 4, permission: 2 });
  assert.deepEqual(res, { project_id: 4, hash: "abc123", permission: 0 });
});

test("create_link_share falls back to the requested permission when Vikunja omits it", async () => {
  const api = async () => ({ data: { id: 1, hash: "abc123" }, headers: headers() }); // no permission echoed
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_link_share").run({ project_id: 4, permission: 1 });
  assert.equal(res.permission, 1);
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_buckets").run({ project_id: 5 });
  assert.deepEqual(res, {
    project_id: 5,
    view_id: 9,
    count: 1,
    items: [{ id: 1, title: "To-Do", limit: 0, count: 2 }],
  });
});

test("create_bucket PUTs the title under the kanban view", async () => {
  const api = kanbanApi(async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/5/views/9/buckets");
    assert.deepEqual(body, { title: "Doing" });
    return { data: { id: 12, title: "Doing" }, headers: new Headers() };
  });
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_bucket").run({ project_id: 5, title: " Doing " });
  assert.deepEqual(res, { id: 12, title: "Doing", limit: 0, count: 0, view_id: 9 });
});

test("move_task_to_bucket POSTs { task_id } to the bucket's tasks endpoint", async () => {
  const api = kanbanApi(async (method, path, body) => {
    assert.equal(method, "POST");
    assert.equal(path, "/projects/5/views/9/buckets/2/tasks");
    assert.deepEqual(body, { task_id: 7 });
    return { data: { bucket_id: 2, task_id: 7 }, headers: new Headers() };
  });
  const res = await byName(buildTools({ api, base: TEST_BASE }), "move_task_to_bucket").run({ project_id: 5, bucket_id: 2, task_id: 7 });
  assert.deepEqual(res, { ok: true, project_id: 5, view_id: 9, bucket_id: 2, task_id: 7 });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_buckets").run({ project_id: 5 });
  assert.equal(res.view_id, 4);
});

test("bucket tools error when the project has no kanban view", async () => {
  const api = async (method, path) => {
    if (path === "/projects/5/views") return { data: [{ id: 1, view_kind: "list" }], headers: new Headers() };
    throw new Error("should not reach the bucket endpoint");
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "list_buckets").run({ project_id: 5 }),
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_task_attachments").run({ task_id: 7 });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "upload_task_attachment").run({
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
    count: 1,
    items: [{ id: 9, name: "note.txt", size: 16, mime: "text/plain", created: null }],
  });
});

test("upload_task_attachment rejects bad base64 before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: { success: [] }, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "upload_task_attachment").run({ task_id: 7, filename: "x", content_base64: "!!!" }),
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
    () => byName(buildTools({ api, base: TEST_BASE }), "upload_task_attachment").run({ task_id: 7, filename: "x", content_base64: content }),
    /upload failed/,
  );
});

test("delete_task_attachment DELETEs /tasks/{id}/attachments/{attachmentId} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/tasks/7/attachments/9");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "delete_task_attachment").run({ task_id: 7, attachment_id: 9 });
  assert.deepEqual(res, { ok: true, task_id: 7, attachment_id: 9 });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_task_relations").run({ task_id: 7 });
  assert.deepEqual(res, { task_id: 7, relations: { related: [{ id: 8, title: "B", done: false }] } });
});

test("create_task_relation validates kind + ids and PUTs the relation", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tasks/7/relations");
    assert.deepEqual(body, { other_task_id: 8, relation_kind: "blocking" });
    return { data: { task_id: 7, other_task_id: 8, relation_kind: "blocking" }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_task_relation").run({
    task_id: 7,
    other_task_id: 8,
    relation_kind: "blocking",
  });
  assert.deepEqual(res, { ok: true, task_id: 7, other_task_id: 8, relation_kind: "blocking" });
});

test("create_task_relation rejects an unknown relation_kind before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "create_task_relation").run({ task_id: 7, other_task_id: 8, relation_kind: "friend" }),
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
    () => byName(buildTools({ api, base: TEST_BASE }), "create_task_relation").run({ task_id: 7, other_task_id: -1, relation_kind: "related" }),
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "delete_task_relation").run({
    task_id: 7,
    other_task_id: 8,
    relation_kind: "related",
  });
  assert.deepEqual(res, { ok: true, task_id: 7, other_task_id: 8, relation_kind: "related" });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_task_comments").run({ task_id: 7, per_page: 20 });
  assert.deepEqual(res.items, [{ id: 1, comment: "hi", author: "me", created: "2026-01-01T00:00:00Z" }]);
});

test("add_task_comment validates and PUTs { comment }, returns the summary", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tasks/7/comments");
    assert.deepEqual(body, { comment: "hello" });
    return { data: { id: 9, comment: "hello", author: { username: "me" } }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "add_task_comment").run({ task_id: 7, comment: "  hello  " });
  assert.deepEqual(res, { id: 9, comment: "hello", author: "me", created: null });
});

test("add_task_comment rejects an empty comment before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "add_task_comment").run({ task_id: 7, comment: "   " }),
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "delete_task_comment").run({ task_id: 7, comment_id: 9 });
  assert.deepEqual(res, { ok: true, task_id: 7, comment_id: 9 });
});

test("search_users hits /users?s= and maps id/username/name; null → []", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/users?s=mc");
    return { data: [{ id: 1, username: "mctester", name: "MC", extra: "drop" }], headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "search_users").run({ query: " mc " });
  assert.deepEqual(res, { count: 1, items: [{ id: 1, username: "mctester", name: "MC" }] });

  const apiNull = async () => ({ data: null, headers: headers() });
  const empty = await byName(buildTools({ api: apiNull, base: TEST_BASE }), "search_users").run({ query: "zzz" });
  assert.deepEqual(empty, { count: 0, items: [] });
});

test("search_users rejects an empty query before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: [], headers: headers() };
  };
  await assert.rejects(() => byName(buildTools({ api, base: TEST_BASE }), "search_users").run({ query: "  " }), /query/);
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_task_assignees").run({ task_id: 7 });
  assert.deepEqual(res, { task_id: 7, count: 1, items: [{ id: 1, username: "me", name: "" }] });
});

test("assign_user PUTs { user_id } and confirms", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tasks/7/assignees");
    assert.deepEqual(body, { user_id: 3 });
    return { data: { user_id: 3 }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "assign_user").run({ task_id: 7, user_id: 3 });
  assert.deepEqual(res, { ok: true, task_id: 7, user_id: 3 });
});

test("unassign_user DELETEs /tasks/{id}/assignees/{userId} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/tasks/7/assignees/3");
    return { data: { message: "ok" }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "unassign_user").run({ task_id: 7, user_id: 3 });
  assert.deepEqual(res, { ok: true, task_id: 7, user_id: 3 });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_labels").run({ per_page: 50 });
  assert.deepEqual(res.items, [{ id: 1, title: "urgent", hex_color: "ff0000" }]);
});

test("create_label PUTs title + optional hex_color and returns the summary", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/labels");
    assert.deepEqual(body, { title: "urgent", hex_color: "ff0000" });
    return { data: { id: 5, title: "urgent", hex_color: "ff0000" }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_label").run({ title: " urgent ", hex_color: "#FF0000" });
  assert.deepEqual(res, { id: 5, title: "urgent", hex_color: "ff0000" });
});

test("add_label_to_task validates ids and PUTs { label_id }", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/tasks/7/labels");
    assert.deepEqual(body, { label_id: 3 });
    return { data: { label_id: 3 }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "add_label_to_task").run({ task_id: 7, label_id: 3 });
  assert.deepEqual(res, { ok: true, task_id: 7, label_id: 3 });
});

test("add_label_to_task rejects a bad label_id before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "add_label_to_task").run({ task_id: 7, label_id: 0 }),
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "remove_label_from_task").run({ task_id: 7, label_id: 3 });
  assert.deepEqual(res, { ok: true, task_id: 7, label_id: 3 });
});

test("get_project validates id, fetches /projects/{id}, shapes the detail", async () => {
  const api = async (method, path) => {
    assert.equal(method, "GET");
    assert.equal(path, "/projects/4");
    return { data: { id: 4, title: "Work", parent_project_id: 0, is_archived: false }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "get_project").run({ project_id: 4 });
  assert.equal(res.id, 4);
  assert.equal(res.parent_project_id, null);
});

test("create_project PUTs title + optional description/parent and returns id/title", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects");
    assert.deepEqual(body, { title: "New", description: "d", parent_project_id: 2 });
    return { data: { id: 8, title: "New", description: "d", parent_project_id: 2, is_archived: false }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_project").run({
    title: "  New  ",
    description: "d",
    parent_project_id: 2,
  });
  assert.deepEqual(res, {
    id: 8,
    title: "New",
    description: "d",
    identifier: "",
    parent_project_id: 2,
    is_archived: false,
    is_favorite: false,
  });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "update_project").run({ project_id: 4, title: "Renamed" });
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
    () => byName(buildTools({ api, base: TEST_BASE }), "update_project").run({ project_id: 4 }),
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
  const tools = buildTools({ api, base: TEST_BASE });
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "delete_project").run({ project_id: 4 });
  assert.deepEqual(res, { ok: true, project_id: 4 });
});

test("delete_task DELETEs /tasks/{id} and confirms", async () => {
  const api = async (method, path) => {
    assert.equal(method, "DELETE");
    assert.equal(path, "/tasks/7");
    return { data: null, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "delete_task").run({ task_id: 7 });
  assert.deepEqual(res, { ok: true, task_id: 7 });
});

test("delete_task validates id before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "delete_task").run({ task_id: 0 }),
    /positive integer/,
  );
  assert.equal(called, false);
});

test("delete_project validates id before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "delete_project").run({ project_id: 0 }),
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "get_task").run({ task_id: 42 });
  assert.equal(res.id, 42);
  assert.equal(res.due_date, null, "zero-date normalized");
});

test("get_task errors when Vikunja returns an empty/malformed body", async () => {
  const api = async () => ({ data: null, headers: headers() });
  await assert.rejects(() => byName(buildTools({ api, base: TEST_BASE }), "get_task").run({ task_id: 5 }), /no task/);
});

test("get_task rejects a bad id before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(() => byName(buildTools({ api, base: TEST_BASE }), "get_task").run({ task_id: 0 }), /positive integer/);
  assert.equal(called, false);
});

test("list_tasks forwards filter/sort_by/order alongside pagination", async () => {
  let seenPath;
  const api = async (_m, path) => {
    seenPath = path;
    return { data: [], headers: headers() };
  };
  await byName(buildTools({ api, base: TEST_BASE }), "list_tasks").run({
    project_id: 3,
    filter: "done = false",
    sort_by: "priority",
    order: "desc",
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_all_tasks").run({
    filter: "priority >= 3",
    sort_by: "due_date",
    order: "asc",
  });
  assert.deepEqual(res.items, [{ id: 5, title: "A", done: false, project_id: 2 }]);
  assert.equal(res.total_pages, 1);
});

test("list_all_tasks rejects an invalid order before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: [], headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "list_all_tasks").run({ order: "up" }),
    /asc.*desc/,
  );
  assert.equal(called, false);
});

test("the real registration filter gates write/delete tiers behind their flags", () => {
  // Mirrors index.js exactly: buildTools(...).filter(t => tierAllowed(t.tier, gate)).
  // buildTools ships only read/additive today, so inject synthetic gated tools
  // to prove the filter drops them by default and admits them per-flag.
  const registry = [
    ...buildTools({ api: noop, base: TEST_BASE }),
    { name: "synthetic_write", tier: "write" },
    { name: "synthetic_delete", tier: "delete" },
  ];
  const exposed = (gate) => registry.filter((t) => tierAllowed(t.tier, gate)).map((t) => t.name);

  const defaultSet = exposed({ allowWrite: false, allowDelete: false });
  assert.ok(!defaultSet.includes("synthetic_write"), "write gated by default");
  assert.ok(!defaultSet.includes("synthetic_delete"), "delete gated by default");
  // every real default tool is read/additive
  for (const t of buildTools({ api: noop, base: TEST_BASE })) {
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_projects").run({});
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
  await byName(buildTools({ api, base: TEST_BASE }), "list_projects").run({ page: 2, per_page: 10 });
  assert.equal(seenPath, "/projects?page=2&per_page=10");
});

test("list_tasks validates project_id before touching the network", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: [], headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "list_tasks").run({ project_id: -1 }),
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
  const res = await byName(buildTools({ api, base: TEST_BASE }), "list_tasks").run({ project_id: 7 });
  assert.deepEqual(res.items, [{ id: 42, title: "T", done: false }]);
});

test("create_task trims the title, PUTs it, and returns the task detail", async () => {
  const api = async (method, path, body) => {
    assert.equal(method, "PUT");
    assert.equal(path, "/projects/5/tasks");
    assert.deepEqual(body, { title: "Hello" });
    return { data: { id: 9, title: "Hello", project_id: 5, done: false }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_task").run({ project_id: 5, title: "  Hello  " });
  assert.equal(res.id, 9);
  assert.equal(res.title, "Hello");
  assert.equal(res.project_id, 5);
  assert.equal(res.done, false);
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
    return { data: { id: 9, title: "Hello", project_id: 5, done: false, description: "d", priority: 4, due_date: "2026-08-01T00:00:00.000Z" }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "create_task").run({
    project_id: 5,
    title: "Hello",
    description: "d",
    due_date: "2026-08-01",
    priority: 4,
  });
  assert.equal(res.id, 9);
  assert.equal(res.title, "Hello");
  assert.equal(res.description, "d");
  assert.equal(res.priority, 4);
});

test("update_task fetch-merges: POSTs the full task with only the changed fields overridden", async () => {
  const seen = [];
  // POST /tasks/{id} is a full-model replace — Vikunja zeroes any field the body
  // omits. So update_task must GET the current task and send it back whole,
  // changing only what the caller asked for. Regression for the partial-body bug
  // that silently wiped due_date/description on a priority-only update.
  const current = {
    id: 12,
    title: "T",
    description: "keep me",
    done: false,
    project_id: 1,
    priority: 2,
    due_date: "2026-08-01T00:00:00Z",
    assignees: [{ id: 3, username: "bob" }],
  };
  const api = async (method, path, body) => {
    seen.push([method, path, body]);
    if (method === "GET") return { data: current, headers: headers() };
    return { data: { ...body }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "update_task").run({ task_id: 12, priority: 5, done: true });
  assert.deepEqual(seen[0], ["GET", "/tasks/12", undefined]);
  const [method, path, body] = seen[1];
  assert.equal(method, "POST");
  assert.equal(path, "/tasks/12");
  // Changed fields applied...
  assert.equal(body.priority, 5);
  assert.equal(body.done, true);
  // ...and every untouched field preserved (the whole point of the merge).
  assert.equal(body.description, "keep me");
  assert.equal(body.due_date, "2026-08-01T00:00:00Z");
  assert.deepEqual(body.assignees, [{ id: 3, username: "bob" }]);
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
    () => byName(buildTools({ api, base: TEST_BASE }), "update_task").run({ task_id: 12 }),
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
    () => byName(buildTools({ api, base: TEST_BASE }), "update_task").run({ task_id: -1, done: true }),
    /positive integer/,
  );
  assert.equal(called, false);
});

test("set_task_done defaults to done=true and can reopen with done=false", async () => {
  const seen = [];
  // Same full-replace contract as update_task: fetch-merge so toggling done
  // doesn't wipe the task's other fields.
  const current = { id: 3, title: "T", done: false, project_id: 1, due_date: "2026-08-01T00:00:00Z" };
  const api = async (method, path, body) => {
    seen.push([method, path, body]);
    if (method === "GET") return { data: current, headers: headers() };
    return { data: { ...current, ...body }, headers: headers() };
  };
  const tools = buildTools({ api, base: TEST_BASE });
  const doneRes = await byName(tools, "set_task_done").run({ task_id: 3 });
  assert.equal(doneRes.done, true);
  const openRes = await byName(tools, "set_task_done").run({ task_id: 3, done: false });
  assert.equal(openRes.done, false);
  assert.deepEqual(seen, [
    ["GET", "/tasks/3", undefined],
    ["POST", "/tasks/3", { ...current, done: true }],
    ["GET", "/tasks/3", undefined],
    ["POST", "/tasks/3", { ...current, done: false }],
  ]);
});

test("create_task rejects an empty title before calling the api", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: { id: 1 }, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "create_task").run({ project_id: 5, title: "   " }),
    /must not be empty/,
  );
  assert.equal(called, false);
});

test("create_task surfaces an empty Vikunja response as an error", async () => {
  const api = async () => ({ data: null, headers: headers() });
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "create_task").run({ project_id: 5, title: "x" }),
    /empty task response/,
  );
});

test("update_label fetch-merges: preserves hex_color AND description when only the title changes", async () => {
  // Label.Update writes Cols("title","description","hex_color") unconditionally,
  // so the merged body must carry the fields we aren't changing or they're
  // zeroed. Regression guard for the description getting wiped on a title edit.
  const api = async (method, path, body) => {
    if (method === "GET") return { data: { id: 3, title: "Old", description: "keep me", hex_color: "aabbcc" }, headers: headers() };
    assert.equal(method, "POST");
    assert.equal(path, "/labels/3");
    assert.equal(body.title, "New");
    assert.equal(body.description, "keep me", "description preserved across a title-only update");
    assert.equal(body.hex_color, "aabbcc", "hex_color preserved");
    return { data: { id: 3, title: "New", hex_color: "aabbcc" }, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "update_label").run({ label_id: 3, title: "New" });
  assert.equal(res.title, "New");
});

test("bulk_update_tasks POSTs task_ids and changed fields to /tasks/bulk", async () => {
  const posted = [];
  const api = async (method, path, body) => {
    posted.push([method, path, body]);
    return { data: {}, headers: headers() };
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "bulk_update_tasks").run({
    task_ids: [1, 2],
    done: true,
    priority: 3,
  });
  assert.deepEqual(res, { ok: true, task_ids: [1, 2] });
  // Vikunja wants { task_ids, fields, values }, not the changed fields flat —
  // a flat body returns 200 but silently updates nothing.
  assert.deepEqual(posted[0][2], {
    task_ids: [1, 2],
    fields: ["done", "priority"],
    values: { done: true, priority: 3 },
  });
});

test("bulk_update_tasks rejects task_ids with no updatable field, before the api call", async () => {
  let called = false;
  const api = async () => {
    called = true;
    return { data: {}, headers: headers() };
  };
  await assert.rejects(
    () => byName(buildTools({ api, base: TEST_BASE }), "bulk_update_tasks").run({ task_ids: [1, 2] }),
    /no fields to update/,
  );
  assert.equal(called, false, "must not POST a no-op bulk update");
});

test("get_caldav_info returns dav URLs and token metadata", async () => {
  const api = async (method, path) => {
    if (path === "/user") return { data: { id: 1, username: "mcptester" }, headers: headers() };
    if (path === "/user/settings/token/caldav") return { data: [{ id: 9, created: "2026-01-01T00:00:00Z" }], headers: headers() };
    throw new Error(`unexpected ${method} ${path}`);
  };
  const res = await byName(buildTools({ api, base: TEST_BASE }), "get_caldav_info").run({});
  assert.equal(res.username, "mcptester");
  assert.equal(res.dav_base_url, "http://vikunja.test/dav");
  assert.deepEqual(res.tokens, [{ id: 9, created: "2026-01-01T00:00:00Z" }]);
});

// --- Unit coverage for handlers previously exercised only by e2e -------------

const build = (api) => buildTools({ api, base: TEST_BASE });

test("delete_label DELETEs /labels/{id} and confirms", async () => {
  const seen = [];
  const api = async (m, p) => (seen.push([m, p]), { data: {}, headers: headers() });
  assert.deepEqual(await byName(build(api), "delete_label").run({ label_id: 4 }), { ok: true, label_id: 4 });
  assert.deepEqual(seen, [["DELETE", "/labels/4"]]);
});

test("update_task_comment POSTs the new text and returns the shaped comment", async () => {
  const api = async (m, p, b) => {
    assert.deepEqual([m, p, b], ["POST", "/tasks/7/comments/3", { comment: "edited" }]);
    return { data: { id: 3, comment: "edited", author: { username: "me" } }, headers: headers() };
  };
  const res = await byName(build(api), "update_task_comment").run({ task_id: 7, comment_id: 3, comment: " edited " });
  assert.equal(res.comment, "edited");
});

test("update_bucket fetch-merges, preserving title when only limit changes", async () => {
  let posted;
  const api = async (m, p, b) => {
    if (p === "/projects/5/views") return { data: [{ id: 9, view_kind: "kanban" }], headers: headers() };
    if (m === "GET") return { data: [{ id: 2, title: "Doing", limit: 3 }], headers: headers() };
    posted = { p, b };
    return { data: { id: 2, title: "Doing", limit: 7 }, headers: headers() };
  };
  const res = await byName(build(api), "update_bucket").run({ project_id: 5, bucket_id: 2, limit: 7 });
  assert.deepEqual(posted, { p: "/projects/5/views/9/buckets/2", b: { title: "Doing", limit: 7 } });
  assert.equal(res.view_id, 9);
});

test("update_bucket errors on no fields, before touching the network", async () => {
  let called = false;
  const api = async () => ((called = true), { data: {}, headers: headers() });
  await assert.rejects(() => byName(build(api), "update_bucket").run({ project_id: 5, bucket_id: 2 }), /no fields to update/);
  assert.equal(called, false);
});

test("delete_bucket resolves the kanban view and DELETEs", async () => {
  const seen = [];
  const api = async (m, p) => {
    if (p === "/projects/5/views") return { data: [{ id: 9, view_kind: "kanban" }], headers: headers() };
    seen.push([m, p]);
    return { data: {}, headers: headers() };
  };
  const res = await byName(build(api), "delete_bucket").run({ project_id: 5, bucket_id: 2 });
  assert.deepEqual(res, { ok: true, project_id: 5, view_id: 9, bucket_id: 2 });
  assert.deepEqual(seen, [["DELETE", "/projects/5/views/9/buckets/2"]]);
});

test("get_team GETs /teams/{id} and shapes members", async () => {
  const api = async (m, p) => {
    assert.deepEqual([m, p], ["GET", "/teams/4"]);
    return { data: { id: 4, name: "Squad", members: [{ id: 2, username: "a", admin: true }] }, headers: headers() };
  };
  const res = await byName(build(api), "get_team").run({ team_id: 4 });
  assert.deepEqual(res, { id: 4, name: "Squad", members: [{ id: 2, username: "a", admin: true }] });
});

test("update_team POSTs the new name", async () => {
  const api = async (m, p, b) => {
    assert.deepEqual([m, p, b], ["POST", "/teams/4", { name: "Renamed" }]);
    return { data: { id: 4, name: "Renamed" }, headers: headers() };
  };
  assert.deepEqual(await byName(build(api), "update_team").run({ team_id: 4, name: " Renamed " }), { id: 4, name: "Renamed" });
});

test("add_team_member PUTs the username (+ optional admin) and returns the member", async () => {
  const api = async (m, p, b) => {
    assert.deepEqual([m, p, b], ["PUT", "/teams/4/members", { username: "bob", admin: true }]);
    return { data: { id: 9, username: "bob", admin: true }, headers: headers() };
  };
  const res = await byName(build(api), "add_team_member").run({ team_id: 4, username: "bob", admin: true });
  assert.deepEqual(res, { team_id: 4, id: 9, username: "bob", admin: true });
});

test("remove_team_member DELETEs /teams/{id}/members/{username} (route is keyed on username)", async () => {
  const api = async (m, p) => {
    assert.deepEqual([m, p], ["DELETE", "/teams/4/members/bob"]);
    return { data: {}, headers: headers() };
  };
  assert.deepEqual(await byName(build(api), "remove_team_member").run({ team_id: 4, username: "bob" }), { ok: true, team_id: 4, username: "bob" });
});

test("remove_team_member url-encodes the username path segment", async () => {
  const api = async (m, p) => {
    assert.deepEqual([m, p], ["DELETE", "/teams/4/members/a%40b.com"]);
    return { data: {}, headers: headers() };
  };
  await byName(build(api), "remove_team_member").run({ team_id: 4, username: "a@b.com" });
});

test("toggle_team_member_admin POSTs /teams/{id}/members/{username}/admin (route is keyed on username)", async () => {
  const api = async (m, p) => {
    assert.deepEqual([m, p], ["POST", "/teams/4/members/bob/admin"]);
    return { data: {}, headers: headers() };
  };
  assert.deepEqual(await byName(build(api), "toggle_team_member_admin").run({ team_id: 4, username: "bob" }), { ok: true, team_id: 4, username: "bob" });
});

test("update_webhook fetch-merges, preserving target_url/events when only secret changes", async () => {
  let posted;
  const api = async (m, p, b) => {
    if (m === "GET") {
      assert.equal(p, "/projects/5/webhooks");
      return { data: [{ id: 2, target_url: "https://x/hook", events: ["task.created"] }], headers: headers() };
    }
    posted = { p, b };
    return { data: { id: 2, target_url: "https://x/hook", events: ["task.created"] }, headers: headers() };
  };
  await byName(build(api), "update_webhook").run({ project_id: 5, webhook_id: 2, secret: "s" });
  assert.deepEqual(posted, {
    p: "/projects/5/webhooks/2",
    b: { target_url: "https://x/hook", events: ["task.created"], secret: "s" },
  });
});

test("update_webhook errors on no fields, before the network", async () => {
  let called = false;
  const api = async () => ((called = true), { data: {}, headers: headers() });
  await assert.rejects(() => byName(build(api), "update_webhook").run({ project_id: 5, webhook_id: 2 }), /no fields to update/);
  assert.equal(called, false);
});

test("set_task_labels POSTs the full label set (allows empty)", async () => {
  const seen = [];
  const api = async (m, p, b) => (seen.push([m, p, b]), { data: {}, headers: headers() });
  const tools = build(api);
  assert.deepEqual(await byName(tools, "set_task_labels").run({ task_id: 7, label_ids: [1, 2] }), {
    ok: true, task_id: 7, label_ids: [1, 2],
  });
  await byName(tools, "set_task_labels").run({ task_id: 7, label_ids: [] });
  assert.deepEqual(seen, [
    ["POST", "/tasks/7/labels/bulk", { labels: [{ id: 1 }, { id: 2 }] }],
    ["POST", "/tasks/7/labels/bulk", { labels: [] }],
  ]);
});

test("set_task_assignees POSTs the full assignee set (allows empty)", async () => {
  const api = async (m, p, b) => {
    assert.deepEqual([m, p, b], ["POST", "/tasks/7/assignees/bulk", { assignees: [{ id: 3 }] }]);
    return { data: {}, headers: headers() };
  };
  assert.deepEqual(await byName(build(api), "set_task_assignees").run({ task_id: 7, user_ids: [3] }), {
    ok: true, task_id: 7, user_ids: [3],
  });
});

test("set_task_labels rejects a non-array before the network", async () => {
  let called = false;
  const api = async () => ((called = true), { data: {}, headers: headers() });
  await assert.rejects(() => byName(build(api), "set_task_labels").run({ task_id: 7, label_ids: 5 }), /must be an array/);
  assert.equal(called, false);
});

test("create_caldav_token PUTs and returns the secret once", async () => {
  const api = async (m, p) => {
    assert.deepEqual([m, p], ["PUT", "/user/settings/token/caldav"]);
    return { data: { id: 3, token: "cd_secret", created: "2026-01-01T00:00:00Z" }, headers: headers() };
  };
  const res = await byName(build(api), "create_caldav_token").run({});
  assert.deepEqual(res, { id: 3, token: "cd_secret", created: "2026-01-01T00:00:00Z" });
});

test("delete_caldav_token DELETEs /user/settings/token/caldav/{id}", async () => {
  const api = async (m, p) => {
    assert.deepEqual([m, p], ["DELETE", "/user/settings/token/caldav/3"]);
    return { data: {}, headers: headers() };
  };
  assert.deepEqual(await byName(build(api), "delete_caldav_token").run({ token_id: 3 }), { ok: true, token_id: 3 });
});

// --- Defensive-branch coverage --------------------------------------------------
// The happy-path tests above always feed Vikunja responses that carry every
// field, so the null/missing sides of tools.js's `?? []` / `?? default` guards
// and the "a different subset of fields changed" merge branches go unexercised.
// These target exactly those, so a regression that drops a fallback is caught.

const nullData = async () => ({ data: null, headers: headers() });

test("list tools return an empty envelope when Vikunja returns null data", async () => {
  const cases = [
    ["list_projects", {}],
    ["list_tasks", { project_id: 1 }],
    ["list_all_tasks", {}],
    ["list_labels", {}],
    ["list_teams", {}],
    ["list_notifications", {}],
    ["list_api_tokens", {}],
    ["list_task_comments", { task_id: 1 }],
    ["list_task_attachments", { task_id: 1 }],
    ["list_webhooks", { project_id: 1 }],
  ];
  for (const [name, args] of cases) {
    const res = await byName(build(nullData), name).run(args);
    assert.equal(res.count, 0, `${name} count`);
    assert.deepEqual(res.items, [], `${name} items`);
  }
});

test("list_task_assignees returns [] for a task with no assignees array", async () => {
  const res = await byName(build(async () => ({ data: { id: 7 }, headers: headers() })), "list_task_assignees").run({ task_id: 7 });
  assert.deepEqual(res, { task_id: 7, count: 0, items: [] });
});

test("list_saved_filters contributes no filters from a null page", async () => {
  const api = async () => ({ data: null, headers: headers({ "x-pagination-total-pages": "1" }) });
  assert.deepEqual(await byName(build(api), "list_saved_filters").run({}), { count: 0, items: [] });
});

test("list_buckets returns [] when the kanban view has null buckets", async () => {
  const api = async (m, p) => {
    if (p === "/projects/5/views") return { data: [{ id: 9, view_kind: "kanban" }], headers: headers() };
    return { data: null, headers: headers() };
  };
  assert.equal((await byName(build(api), "list_buckets").run({ project_id: 5 })).count, 0);
});

test("kanban tools throw 'no kanban view' when the views list is null", async () => {
  await assert.rejects(() => byName(build(nullData), "list_buckets").run({ project_id: 5 }), /no kanban view/);
});

test("get_caldav_info tolerates a null CalDAV token list", async () => {
  const api = async (m, p) => {
    if (p === "/user") return { data: { id: 1, username: "me" }, headers: headers() };
    return { data: null, headers: headers() };
  };
  assert.deepEqual((await byName(build(api), "get_caldav_info").run({})).tokens, []);
});

test("upload_task_attachment returns an empty list when Vikunja returns null data", async () => {
  const content = Buffer.from("x").toString("base64");
  const res = await byName(build(nullData), "upload_task_attachment").run({ task_id: 7, filename: "x", content_base64: content });
  assert.deepEqual(res, { task_id: 7, count: 0, items: [] });
});

test("list_labels and create_label default a missing hex_color to ''", async () => {
  const list = await byName(build(async () => ({ data: [{ id: 1, title: "x" }], headers: headers() })), "list_labels").run({});
  assert.equal(list.items[0].hex_color, "");
  const created = await byName(build(async () => ({ data: { id: 5, title: "x" }, headers: headers() })), "create_label").run({ title: "x" });
  assert.equal(created.hex_color, "");
});

test("create_api_token and create_caldav_token default missing timestamps to null", async () => {
  const tok = await byName(
    build(async () => ({ data: { id: 5, title: "CI", token: "tk" }, headers: headers() })),
    "create_api_token",
  ).run({ title: "CI", expires_at: "2027-01-01T00:00:00Z", permissions: { tasks: ["read_all"] } });
  assert.equal(tok.expires_at, null);
  const cd = await byName(build(async () => ({ data: { id: 3, token: "cd" }, headers: headers() })), "create_caldav_token").run({});
  assert.equal(cd.created, null);
});

test("share_project_with_team defaults the permission to read (0) when omitted", async () => {
  const api = async (m, p, b) => {
    assert.equal(b.permission, 0);
    return { data: { team_id: b.team_id, permission: 0 }, headers: headers() };
  };
  assert.equal((await byName(build(api), "share_project_with_team").run({ project_id: 4, team_id: 2 })).permission, 0);
});

test("update_task applies description and due_date (not just priority/done)", async () => {
  let posted;
  const api = async (m, p, b) => {
    if (m === "GET") return { data: { id: 7, title: "T", done: false, project_id: 1 }, headers: headers() };
    posted = b;
    return { data: { ...b }, headers: headers() };
  };
  await byName(build(api), "update_task").run({ task_id: 7, description: "d", due_date: "2026-08-01" });
  assert.equal(posted.description, "d");
  assert.equal(posted.due_date, "2026-08-01T00:00:00.000Z");
});

test("update_project applies description and parent_project_id", async () => {
  let posted;
  const api = async (m, p, b) => {
    if (m === "GET") return { data: { id: 4, title: "P" }, headers: headers() };
    posted = b;
    return { data: { id: 4, title: "P", ...b }, headers: headers() };
  };
  await byName(build(api), "update_project").run({ project_id: 4, description: "d", parent_project_id: 2 });
  assert.equal(posted.description, "d");
  assert.equal(posted.parent_project_id, 2);
});

test("update_label changes hex_color only, preserving the current title", async () => {
  let posted;
  const api = async (m, p, b) => {
    if (m === "GET") return { data: { id: 3, title: "Keep", hex_color: "000000" }, headers: headers() };
    posted = b;
    return { data: { id: 3, title: "Keep", hex_color: "abcdef" }, headers: headers() };
  };
  const res = await byName(build(api), "update_label").run({ label_id: 3, hex_color: "#ABCDEF" });
  assert.equal(posted.title, "Keep", "title preserved (title-undefined branch)");
  assert.equal(posted.hex_color, "abcdef");
  assert.equal(res.hex_color, "abcdef");
});

test("update_saved_filter applies title + description and tolerates a filter-less current", async () => {
  let posted;
  const api = async (m, p, b) => {
    if (m === "GET") return { data: { id: 5, title: "Old" }, headers: headers() }; // no `filters` object
    posted = b;
    return { data: { id: 5, title: b.title, description: b.description, filters: b.filters }, headers: headers() };
  };
  const res = await byName(build(api), "update_saved_filter").run({ filter_id: 5, title: "New", description: "d" });
  assert.equal(posted.title, "New");
  assert.equal(posted.description, "d");
  assert.deepEqual(posted.filters, { filter: "" }, "filter defaults to '' when neither changed nor present");
  assert.equal(res.title, "New");
});

test("update_webhook applies new events, and defaults a missing current events to []", async () => {
  // change events on a current webhook that has none -> exercises requireEvents(events)
  let posted;
  const withEvents = async (m, p, b) => {
    if (m === "GET") return { data: [{ id: 8, target_url: "https://x" }], headers: headers() };
    posted = b;
    return { data: { id: 8, target_url: "https://x", events: b.events }, headers: headers() };
  };
  await byName(build(withEvents), "update_webhook").run({ project_id: 4, webhook_id: 8, events: ["task.created"] });
  assert.deepEqual(posted.events, ["task.created"]);

  // change only target_url on a current webhook with no events -> current.events ?? []
  let posted2;
  const noEvents = async (m, p, b) => {
    if (m === "GET") return { data: [{ id: 8, target_url: "https://x" }], headers: headers() };
    posted2 = b;
    return { data: { id: 8, target_url: b.target_url, events: b.events }, headers: headers() };
  };
  await byName(build(noEvents), "update_webhook").run({ project_id: 4, webhook_id: 8, target_url: "https://y" });
  assert.deepEqual(posted2.events, []);
});

test("update_webhook / update_bucket error when the target list comes back null", async () => {
  await assert.rejects(
    () => byName(build(nullData), "update_webhook").run({ project_id: 4, webhook_id: 8, secret: "s" }),
    /webhook 8 not found/,
  );
  const bucketApi = async (m, p) => {
    if (p === "/projects/5/views") return { data: [{ id: 9, view_kind: "kanban" }], headers: headers() };
    return { data: null, headers: headers() };
  };
  await assert.rejects(
    () => byName(build(bucketApi), "update_bucket").run({ project_id: 5, bucket_id: 2, title: "X" }),
    /bucket 2 not found/,
  );
});

test("bulk_update_tasks carries title/description/due_date into fields+values", async () => {
  let posted;
  const api = async (m, p, b) => ((posted = b), { data: {}, headers: headers() });
  await byName(build(api), "bulk_update_tasks").run({ task_ids: [1], title: "T", description: "d", due_date: "2026-08-01" });
  assert.deepEqual([...posted.fields].sort(), ["description", "due_date", "title"]);
  assert.equal(posted.values.title, "T");
  assert.equal(posted.values.description, "d");
  assert.equal(posted.values.due_date, "2026-08-01T00:00:00.000Z");
});

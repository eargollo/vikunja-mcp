// Negative-path unit tests for the tool handlers in tools.js. These exercise
// the error guards — empty/malformed Vikunja responses and pre-network input
// validation — that the happy-path tests in tools.test.js don't reach. Each
// stubs api() to return the shape that trips one guard and asserts the thrown
// message. No server, no network.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTools } from "../tools.js";

const TEST_BASE = "http://vikunja.test/api/v1";
const headers = (obj) => new Headers(obj);
const byName = (tools, name) => tools.find((t) => t.name === name);
// api() that fails loudly if a handler calls it — for guards that fire before
// any network access (pure input validation).
const noApi = async (method, path) => {
  throw new Error(`api should not be called (got ${method} ${path})`);
};
// Build one tool's run() with a given api stub.
const run = (name, api, base = TEST_BASE) => byName(buildTools({ api, base }), name).run;
// Reply for a single (method, path); everything else throws.
const reply = (method, path, data) => async (m, p) => {
  assert.equal(m, method);
  assert.equal(p, path);
  return { data, headers: headers() };
};

// A tiny router: map "METHOD /path" -> data. Missing keys throw (catches a
// handler taking an unexpected route).
const router = (routes) => async (method, path) => {
  const key = `${method} ${path}`;
  if (!(key in routes)) throw new Error(`unexpected api call: ${key}`);
  return { data: routes[key], headers: headers() };
};

test("update_project throws when the current project GET is empty", async () => {
  const r = run("update_project", reply("GET", "/projects/4", null));
  await assert.rejects(() => r({ project_id: 4, title: "X" }), /returned no project/);
});

test("update_project throws when the merged POST returns an empty project", async () => {
  const api = router({
    "GET /projects/4": { id: 4, title: "Old" },
    "POST /projects/4": null,
  });
  await assert.rejects(() => run("update_project", api)({ project_id: 4, title: "X" }), /empty project response/);
});

test("update_saved_filter throws when the current filter GET is empty", async () => {
  const r = run("update_saved_filter", reply("GET", "/filters/5", null));
  await assert.rejects(() => r({ filter_id: 5, filter: "done = false" }), /returned no saved filter/);
});

test("update_saved_filter throws when the merged POST returns an empty filter", async () => {
  const api = router({
    "GET /filters/5": { id: 5, title: "Old", filters: { filter: "x" } },
    "POST /filters/5": null,
  });
  await assert.rejects(() => run("update_saved_filter", api)({ filter_id: 5, filter: "y" }), /empty saved filter response/);
});

test("update_task throws when the current task GET is empty", async () => {
  const r = run("update_task", reply("GET", "/tasks/7", null));
  await assert.rejects(() => r({ task_id: 7, title: "X" }), /returned no task/);
});

test("update_task throws when the merged POST returns an empty task", async () => {
  const api = router({
    "GET /tasks/7": { id: 7, title: "Old" },
    "POST /tasks/7": null,
  });
  await assert.rejects(() => run("update_task", api)({ task_id: 7, title: "X" }), /empty task response/);
});

test("set_task_done throws when the current task GET is empty", async () => {
  const r = run("set_task_done", reply("GET", "/tasks/7", null));
  await assert.rejects(() => r({ task_id: 7 }), /returned no task/);
});

test("set_task_done throws when the merged POST returns an empty task", async () => {
  const api = router({
    "GET /tasks/7": { id: 7, title: "Old" },
    "POST /tasks/7": null,
  });
  await assert.rejects(() => run("set_task_done", api)({ task_id: 7 }), /empty task response/);
});

test("get_project throws when the GET is empty", async () => {
  const r = run("get_project", reply("GET", "/projects/4", null));
  await assert.rejects(() => r({ project_id: 4 }), /returned no project/);
});

test("create_project throws when the PUT returns an empty project", async () => {
  const r = run("create_project", reply("PUT", "/projects", null));
  await assert.rejects(() => r({ title: "X" }), /empty project response/);
});

test("create_label throws when the PUT returns an empty label", async () => {
  const r = run("create_label", reply("PUT", "/labels", null));
  await assert.rejects(() => r({ title: "X" }), /empty label response/);
});

test("update_label rejects when no fields are supplied, before the network", async () => {
  await assert.rejects(() => run("update_label", noApi)({ label_id: 3 }), /no fields to update/);
});

test("update_label throws when the current label GET is empty", async () => {
  const r = run("update_label", reply("GET", "/labels/3", null));
  await assert.rejects(() => r({ label_id: 3, title: "X" }), /returned no label/);
});

test("update_label throws when the merged POST returns an empty label", async () => {
  const api = router({
    "GET /labels/3": { id: 3, title: "Old" },
    "POST /labels/3": null,
  });
  await assert.rejects(() => run("update_label", api)({ label_id: 3, title: "X" }), /empty label response/);
});

test("list_task_assignees throws when the task GET is empty", async () => {
  const r = run("list_task_assignees", reply("GET", "/tasks/7", null));
  await assert.rejects(() => r({ task_id: 7 }), /returned no task/);
});

test("add_task_comment throws when the PUT returns an empty comment", async () => {
  const r = run("add_task_comment", reply("PUT", "/tasks/7/comments", null));
  await assert.rejects(() => r({ task_id: 7, comment: "hi" }), /empty comment response/);
});

test("update_task_comment throws when the POST returns an empty comment", async () => {
  const r = run("update_task_comment", reply("POST", "/tasks/7/comments/2", null));
  await assert.rejects(() => r({ task_id: 7, comment_id: 2, comment: "hi" }), /empty comment response/);
});

test("list_task_relations throws when the task GET is empty", async () => {
  const r = run("list_task_relations", reply("GET", "/tasks/7", null));
  await assert.rejects(() => r({ task_id: 7 }), /returned no task/);
});

test("create_bucket throws when the PUT returns an empty bucket", async () => {
  const api = router({
    "GET /projects/5/views": [{ id: 9, view_kind: "kanban" }],
    "PUT /projects/5/views/9/buckets": null,
  });
  await assert.rejects(() => run("create_bucket", api)({ project_id: 5, title: "X" }), /empty bucket response/);
});

test("update_bucket throws when the bucket id is not in the view", async () => {
  const api = router({
    "GET /projects/5/views": [{ id: 9, view_kind: "kanban" }],
    "GET /projects/5/views/9/buckets": [{ id: 99, title: "Other" }],
  });
  await assert.rejects(() => run("update_bucket", api)({ project_id: 5, bucket_id: 2, title: "X" }), /bucket 2 not found in project 5/);
});

test("update_bucket rejects a negative limit", async () => {
  const api = router({
    "GET /projects/5/views": [{ id: 9, view_kind: "kanban" }],
    "GET /projects/5/views/9/buckets": [{ id: 2, title: "Doing", limit: 3 }],
  });
  await assert.rejects(() => run("update_bucket", api)({ project_id: 5, bucket_id: 2, limit: -1 }), /limit must be a non-negative integer/);
});

test("update_bucket preserves the current limit when only the title changes", async () => {
  const api = router({
    "GET /projects/5/views": [{ id: 9, view_kind: "kanban" }],
    "GET /projects/5/views/9/buckets": [{ id: 2, title: "Doing", limit: 5 }],
    "POST /projects/5/views/9/buckets/2": { id: 2, title: "Renamed", limit: 5 },
  });
  const res = await run("update_bucket", api)({ project_id: 5, bucket_id: 2, title: "Renamed" });
  assert.deepEqual(res, { id: 2, title: "Renamed", limit: 5, count: 0, view_id: 9 });
});

test("update_bucket throws when the merged POST returns an empty bucket", async () => {
  const api = router({
    "GET /projects/5/views": [{ id: 9, view_kind: "kanban" }],
    "GET /projects/5/views/9/buckets": [{ id: 2, title: "Doing", limit: 5 }],
    "POST /projects/5/views/9/buckets/2": null,
  });
  await assert.rejects(() => run("update_bucket", api)({ project_id: 5, bucket_id: 2, title: "X" }), /empty bucket response/);
});

test("create_team throws when the PUT returns an empty team", async () => {
  const r = run("create_team", reply("PUT", "/teams", null));
  await assert.rejects(() => r({ name: "X" }), /empty team response/);
});

test("get_team throws when the GET is empty", async () => {
  const r = run("get_team", reply("GET", "/teams/2", null));
  await assert.rejects(() => r({ team_id: 2 }), /returned no team/);
});

test("update_team throws when the POST returns an empty team", async () => {
  const r = run("update_team", reply("POST", "/teams/2", null));
  await assert.rejects(() => r({ team_id: 2, name: "X" }), /empty team response/);
});

test("add_team_member throws when the PUT returns an empty member", async () => {
  const r = run("add_team_member", reply("PUT", "/teams/2/members", null));
  await assert.rejects(() => r({ team_id: 2, username: "bob" }), /empty team member response/);
});

test("create_link_share throws when the PUT returns no hash", async () => {
  const r = run("create_link_share", reply("PUT", "/projects/4/shares", {}));
  await assert.rejects(() => r({ project_id: 4 }), /empty share response/);
});

test("create_saved_filter throws when the PUT returns an empty filter", async () => {
  const r = run("create_saved_filter", reply("PUT", "/filters", null));
  await assert.rejects(() => r({ title: "X", filter: "done = false" }), /empty saved filter response/);
});

test("get_current_user throws when the GET is empty", async () => {
  const r = run("get_current_user", reply("GET", "/user", null));
  await assert.rejects(() => r({}), /returned no user/);
});

test("create_api_token throws when the PUT returns an empty token", async () => {
  const r = run("create_api_token", reply("PUT", "/tokens", null));
  await assert.rejects(
    () => r({ title: "X", expires_at: "2027-01-01T00:00:00Z", permissions: { tasks: ["read_all"] } }),
    /empty token response/,
  );
});

test("create_webhook rejects a non-string secret, before the network", async () => {
  await assert.rejects(
    () => run("create_webhook", noApi)({ project_id: 4, target_url: "https://x", events: ["task.created"], secret: 123 }),
    /secret must be a string/,
  );
});

test("create_webhook throws when the PUT returns an empty webhook", async () => {
  const r = run("create_webhook", reply("PUT", "/projects/4/webhooks", null));
  await assert.rejects(() => r({ project_id: 4, target_url: "https://x", events: ["task.created"] }), /empty webhook response/);
});

test("update_webhook throws when the webhook id is not in the project", async () => {
  const api = router({ "GET /projects/4/webhooks": [{ id: 99, target_url: "https://old", events: [] }] });
  await assert.rejects(
    () => run("update_webhook", api)({ project_id: 4, webhook_id: 8, target_url: "https://x" }),
    /webhook 8 not found in project 4/,
  );
});

test("update_webhook rejects a non-string secret once the current webhook is found", async () => {
  const api = router({ "GET /projects/4/webhooks": [{ id: 8, target_url: "https://old", events: ["task.created"] }] });
  await assert.rejects(
    () => run("update_webhook", api)({ project_id: 4, webhook_id: 8, secret: 123 }),
    /secret must be a string/,
  );
});

test("update_webhook throws when the merged POST returns an empty webhook", async () => {
  const api = router({
    "GET /projects/4/webhooks": [{ id: 8, target_url: "https://old", events: ["task.created"] }],
    "POST /projects/4/webhooks/8": null,
  });
  await assert.rejects(
    () => run("update_webhook", api)({ project_id: 4, webhook_id: 8, target_url: "https://new" }),
    /empty webhook response/,
  );
});

test("set_task_assignees rejects a non-array user_ids, before the network", async () => {
  await assert.rejects(() => run("set_task_assignees", noApi)({ task_id: 7, user_ids: "nope" }), /user_ids must be an array/);
});

test("get_caldav_info throws when the user GET is empty", async () => {
  const r = run("get_caldav_info", reply("GET", "/user", null));
  await assert.rejects(() => r({}), /returned no user/);
});

test("create_caldav_token throws when the PUT returns a token without a secret", async () => {
  const r = run("create_caldav_token", reply("PUT", "/user/settings/token/caldav", { id: 5 }));
  await assert.rejects(() => r({}), /empty CalDAV token response/);
});

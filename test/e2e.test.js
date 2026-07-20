// End-to-end test: start index.js as a real MCP server over stdio and exercise
// every tool against a live Vikunja.
//
//   list_projects -> create_task -> list_tasks (confirm the task shows up)
//   plus the tool-level error paths (bad args, unknown tool).
//
// Requires a running Vikunja and VIKUNJA_URL / VIKUNJA_API_TOKEN in the env.
// Run it with:  npm run test:e2e   (docker compose up -d && npm run bootstrap first)
// Skips cleanly when those aren't set, so `npm test` stays offline and fast.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "index.js");

const hasEnv = Boolean(process.env.VIKUNJA_URL && process.env.VIKUNJA_API_TOKEN);
const skip = hasEnv ? false : "set VIKUNJA_URL and VIKUNJA_API_TOKEN (run `npm run bootstrap`) to run e2e";

// The MCP wraps tool results as [{ type: "text", text: "<json>" }]; unwrap it.
function parse(result) {
  assert.ok(!result.isError, `tool returned an error: ${result.content?.[0]?.text}`);
  return JSON.parse(result.content[0].text);
}

// Authenticated Vikunja REST call for the few things the MCP has no tool for
// (reading a share back, seeding/reading a label description). Keeps the base
// URL + bearer header in one place so the raw wire format isn't re-derived per
// test. Not for /register — that's unauthenticated (see registerUser).
function vikunjaREST(path, init = {}) {
  return fetch(`${process.env.VIKUNJA_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.VIKUNJA_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

// Register a throwaway user straight against Vikunja's REST API — there is no
// "register" MCP tool, and the team-member endpoints need a *second* member to
// act on (bootstrap only creates one). Unauthenticated (public endpoint), so it
// doesn't go through vikunjaREST. Idempotent: an already-registered user (400)
// is fine on a re-run. Returns the username, which the team endpoints key on.
async function registerUser(username) {
  const res = await fetch(`${process.env.VIKUNJA_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@example.com`, password: `${username}-password` }),
  });
  assert.ok(res.ok || res.status === 400, `register ${username} failed: ${res.status}`);
  return username;
}

// Spawn a server + connected client with optional extra env (e.g. gating flags).
function spawnClient(name, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: { ...process.env, ...extraEnv },
    stderr: "inherit",
  });
  const c = new Client({ name, version: "0.1.0" });
  return { client: c, transport };
}

let client; // default: no gating flags
let writeClient; // both write+delete flags on

before(async () => {
  if (!hasEnv) return;
  const spawned = spawnClient("vikunja-mcp-e2e");
  client = spawned.client;
  await client.connect(spawned.transport);
});

after(async () => {
  if (client) await client.close();
  if (writeClient) await writeClient.close();
});

// Lazily connect the flag-enabled client only when a write test needs it.
async function getWriteClient() {
  if (!writeClient) {
    const spawned = spawnClient("vikunja-mcp-e2e-write", {
      VIKUNJA_MCP_ALLOW_WRITE: "1",
      VIKUNJA_MCP_ALLOW_DELETE: "1",
    });
    writeClient = spawned.client;
    await writeClient.connect(spawned.transport);
  }
  return writeClient;
}

test("exposes exactly the read + additive tool set by default", { skip }, async () => {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "add_label_to_task",
    "add_task_comment",
    "add_team_member",
    "assign_user",
    "create_bucket",
    "create_label",
    "create_project",
    "create_saved_filter",
    "create_task",
    "create_task_relation",
    "create_team",
    "get_caldav_info",
    "get_current_user",
    "get_project",
    "get_task",
    "get_team",
    "list_all_tasks",
    "list_api_tokens",
    "list_buckets",
    "list_labels",
    "list_notifications",
    "list_projects",
    "list_saved_filters",
    "list_task_assignees",
    "list_task_attachments",
    "list_task_comments",
    "list_task_relations",
    "list_tasks",
    "list_teams",
    "list_webhooks",
    "search_users",
    "subscribe",
    "upload_task_attachment",
  ]);
  for (const gated of [
    "update_task",
    "set_task_done",
    "bulk_update_tasks",
    "set_task_labels",
    "set_task_assignees",
    "update_project",
    "archive_project",
    "delete_project",
    "delete_task",
    "update_label",
    "delete_label",
    "remove_label_from_task",
    "unassign_user",
    "update_task_comment",
    "delete_task_comment",
    "delete_task_relation",
    "delete_task_attachment",
    "update_bucket",
    "delete_bucket",
    "move_task_to_bucket",
    "update_team",
    "remove_team_member",
    "toggle_team_member_admin",
    "update_saved_filter",
    "delete_saved_filter",
    "mark_notification_read",
    "unsubscribe",
    "create_api_token",
    "create_caldav_token",
    "delete_caldav_token",
    "create_link_share",
    "create_webhook",
    "update_webhook",
    "share_project_with_team",
    "share_project_with_user",
    "delete_webhook",
  ]) {
    assert.ok(!names.includes(gated), `${gated} must be gated off by default`);
  }
});

test("VIKUNJA_MCP_ALLOW_WRITE exposes the write tools without dropping the baseline", { skip }, async () => {
  const wc = await getWriteClient();
  const names = new Set((await wc.listTools()).tools.map((t) => t.name));
  for (const base of ["create_task", "get_task", "list_projects", "list_tasks", "list_all_tasks"]) {
    assert.ok(names.has(base), `${base} should still be exposed with flags set`);
  }
  assert.ok(names.has("update_task"), "update_task appears when write is enabled");
  assert.ok(names.has("set_task_done"), "set_task_done appears when write is enabled");
});

test("tools/list advertises titles and tier-derived annotations", { skip }, async () => {
  const tools = Object.fromEntries((await client.listTools()).tools.map((t) => [t.name, t]));
  assert.equal(tools.list_projects.title, "List Projects", "tools carry a display title");
  // read tool → read-only, non-destructive
  assert.equal(tools.list_projects.annotations?.readOnlyHint, true);
  assert.equal(tools.list_projects.annotations?.destructiveHint, false);
  // additive tool → not read-only, not destructive
  assert.equal(tools.create_task.annotations?.readOnlyHint, false);
  assert.equal(tools.create_task.annotations?.destructiveHint, false);

  // delete tools (gated) advertise destructive + idempotent; reversible ones don't
  const wtools = Object.fromEntries((await (await getWriteClient()).listTools()).tools.map((t) => [t.name, t]));
  assert.equal(wtools.delete_project.annotations?.destructiveHint, true);
  assert.equal(wtools.delete_project.annotations?.idempotentHint, true);
  assert.equal(wtools.remove_label_from_task.annotations?.destructiveHint, false, "reversible delete");
});

test("call results include structuredContent mirroring the text payload", { skip }, async () => {
  const res = await client.callTool({ name: "list_projects", arguments: {} });
  assert.ok(!res.isError);
  assert.ok(res.structuredContent && typeof res.structuredContent === "object", "structuredContent present");
  assert.ok(Array.isArray(res.structuredContent.items), "structuredContent.items is an array");
  assert.deepEqual(res.structuredContent, JSON.parse(res.content[0].text), "structured matches text");
});

test("list_projects returns a paginated envelope with the seeded Inbox", { skip }, async () => {
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  assert.ok(Array.isArray(projects.items), "items should be an array");
  assert.equal(projects.count, projects.items.length);
  assert.equal(projects.page, 1);
  assert.ok(projects.items.length >= 1, "Vikunja seeds an Inbox project");
});

test("create_task then list_tasks round-trips the new task", { skip }, async () => {
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const projectId = projects.items[0].id;
  const title = `e2e task ${process.hrtime.bigint()}`;

  const created = parse(
    await client.callTool({ name: "create_task", arguments: { project_id: projectId, title } }),
  );
  assert.ok(Number.isInteger(created.id), "created task should have a numeric id");
  assert.equal(created.title, title);

  const tasks = parse(await client.callTool({ name: "list_tasks", arguments: { project_id: projectId } }));
  const found = tasks.items.find((t) => t.id === created.id);
  assert.ok(found, "created task should appear in list_tasks");
  assert.equal(found.title, title);
});

test("get_task returns the full detail of a created task", { skip }, async () => {
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const projectId = projects.items[0].id;
  const title = `e2e detail ${process.hrtime.bigint()}`;
  const created = parse(
    await client.callTool({ name: "create_task", arguments: { project_id: projectId, title } }),
  );

  const detail = parse(await client.callTool({ name: "get_task", arguments: { task_id: created.id } }));
  assert.equal(detail.id, created.id);
  assert.equal(detail.title, title);
  assert.equal(detail.project_id, projectId);
  assert.equal(detail.done, false);
  // unset dates normalize to null rather than Vikunja's "0001-01-01…"
  assert.equal(detail.due_date, null);
});

test("list_all_tasks finds a created task across projects and supports filter", { skip }, async () => {
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const projectId = projects.items[0].id;
  const title = `e2e all ${process.hrtime.bigint()}`;
  const created = parse(
    await client.callTool({ name: "create_task", arguments: { project_id: projectId, title } }),
  );

  // Sort newest-first so the just-created task is on page 1 regardless of how
  // many tasks the throwaway instance has accumulated.
  const all = parse(
    await client.callTool({
      name: "list_all_tasks",
      arguments: { filter: "done = false", sort_by: "id", order: "desc" },
    }),
  );
  const found = all.items.find((t) => t.id === created.id);
  assert.ok(found, "created task should appear in list_all_tasks");
  assert.equal(found.project_id, projectId);
});

test("get_task with a bad id surfaces a tool error", { skip }, async () => {
  const result = await client.callTool({ name: "get_task", arguments: { task_id: 0 } });
  assert.ok(result.isError, "expected isError for a bad task_id");
  assert.match(result.content[0].text, /positive integer/);
});

test("create_task accepts optional description/due_date/priority", { skip }, async () => {
  const wc = await getWriteClient();
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const created = parse(
    await wc.callTool({
      name: "create_task",
      arguments: {
        project_id: projects.items[0].id,
        title: `e2e rich ${process.hrtime.bigint()}`,
        description: "from e2e",
        due_date: "2026-08-01T09:00:00Z",
        priority: 4,
      },
    }),
  );
  const detail = parse(await wc.callTool({ name: "get_task", arguments: { task_id: created.id } }));
  assert.equal(detail.description, "from e2e");
  assert.equal(detail.priority, 4);
  // Compare the instant, not the exact string form Vikunja happens to echo.
  assert.equal(Date.parse(detail.due_date), Date.parse("2026-08-01T09:00:00Z"));
});

test("update_task changes the provided field and preserves the rest (full-replace guard)", { skip }, async () => {
  const wc = await getWriteClient();
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  // Seed a task that already carries a description AND a due_date...
  const created = parse(
    await wc.callTool({
      name: "create_task",
      arguments: {
        project_id: projects.items[0].id,
        title: `e2e update ${process.hrtime.bigint()}`,
        description: "keep me",
        due_date: "2026-08-01T09:00:00Z",
      },
    }),
  );
  // ...then change ONLY the priority.
  const updated = parse(
    await wc.callTool({ name: "update_task", arguments: { task_id: created.id, priority: 5 } }),
  );
  assert.equal(updated.id, created.id);
  assert.equal(updated.priority, 5, "the requested field changed");

  // Re-fetch to assert *persisted* state. POST /tasks/{id} is a full-model
  // replace, so a partial body used to zero every field the caller omitted —
  // this is the regression guard for that bug. The old version of this test only
  // asserted the fields it changed, which is exactly why it never caught it.
  const detail = parse(await wc.callTool({ name: "get_task", arguments: { task_id: created.id } }));
  assert.equal(detail.priority, 5);
  assert.equal(detail.description, "keep me", "description survived a priority-only update");
  assert.equal(Date.parse(detail.due_date), Date.parse("2026-08-01T09:00:00Z"), "due_date survived");
});

test("set_task_done marks/reopens a task without wiping its other fields", { skip }, async () => {
  const wc = await getWriteClient();
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const created = parse(
    await wc.callTool({
      name: "create_task",
      arguments: {
        project_id: projects.items[0].id,
        title: `e2e done ${process.hrtime.bigint()}`,
        due_date: "2026-08-01T09:00:00Z",
      },
    }),
  );
  const done = parse(await wc.callTool({ name: "set_task_done", arguments: { task_id: created.id } }));
  assert.equal(done.done, true);
  // Same full-replace guard: toggling done must not clear the due_date.
  assert.equal(Date.parse(done.due_date), Date.parse("2026-08-01T09:00:00Z"), "due_date survives set_task_done");
  const reopened = parse(
    await wc.callTool({ name: "set_task_done", arguments: { task_id: created.id, done: false } }),
  );
  assert.equal(reopened.done, false);
  assert.equal(Date.parse(reopened.due_date), Date.parse("2026-08-01T09:00:00Z"), "due_date survives reopen");
});

test("update_task is not callable without the write flag", { skip }, async () => {
  const result = await client.callTool({ name: "update_task", arguments: { task_id: 1, done: true } });
  assert.ok(result.isError, "gated-out tool must not be callable");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("set_task_done is not callable without the write flag", { skip }, async () => {
  const result = await client.callTool({ name: "set_task_done", arguments: { task_id: 1 } });
  assert.ok(result.isError, "gated-out tool must not be callable");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("create_project then get_project round-trips (additive + read)", { skip }, async () => {
  const created = parse(
    await client.callTool({
      name: "create_project",
      arguments: { title: `e2e project ${process.hrtime.bigint()}`, description: "made in e2e" },
    }),
  );
  assert.ok(Number.isInteger(created.id));
  const detail = parse(await client.callTool({ name: "get_project", arguments: { project_id: created.id } }));
  assert.equal(detail.id, created.id);
  assert.equal(detail.description, "made in e2e");
  assert.equal(detail.is_archived, false);
});

test("update_project and archive_project change fields while preserving the rest (write)", { skip }, async () => {
  const wc = await getWriteClient();
  // Seed a description so we can assert it survives a title-only update — this is
  // the full-replace preservation guard that was missing from every merge tool.
  const created = parse(
    await wc.callTool({
      name: "create_project",
      arguments: { title: `e2e proj upd ${process.hrtime.bigint()}`, description: "keep me" },
    }),
  );
  const renamed = parse(
    await wc.callTool({ name: "update_project", arguments: { project_id: created.id, title: "Renamed E2E" } }),
  );
  assert.equal(renamed.title, "Renamed E2E");
  assert.equal(renamed.description, "keep me", "description survived a title-only update");
  // Archiving must also preserve the (now renamed) title and description.
  const archived = parse(await wc.callTool({ name: "archive_project", arguments: { project_id: created.id } }));
  assert.equal(archived.is_archived, true);
  assert.equal(archived.title, "Renamed E2E", "title survived archive");
  assert.equal(archived.description, "keep me", "description survived archive");
  const unarchived = parse(
    await wc.callTool({ name: "archive_project", arguments: { project_id: created.id, archived: false } }),
  );
  assert.equal(unarchived.is_archived, false);
});

test("delete_project removes a project (delete tier)", { skip }, async () => {
  const wc = await getWriteClient();
  const created = parse(
    await wc.callTool({ name: "create_project", arguments: { title: `e2e proj del ${process.hrtime.bigint()}` } }),
  );
  const res = parse(await wc.callTool({ name: "delete_project", arguments: { project_id: created.id } }));
  assert.deepEqual(res, { ok: true, project_id: created.id });
  // it should be gone now
  const after = await wc.callTool({ name: "get_project", arguments: { project_id: created.id } });
  assert.ok(after.isError, "deleted project should no longer be fetchable");
});

test("delete_project is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({ name: "delete_project", arguments: { project_id: 1 } });
  assert.ok(result.isError, "delete tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("delete_task removes a task (delete tier)", { skip }, async () => {
  const wc = await getWriteClient();
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const projectId = projects.items[0].id;
  const created = parse(
    await wc.callTool({
      name: "create_task",
      arguments: { project_id: projectId, title: `e2e task del ${process.hrtime.bigint()}` },
    }),
  );
  const res = parse(await wc.callTool({ name: "delete_task", arguments: { task_id: created.id } }));
  assert.deepEqual(res, { ok: true, task_id: created.id });
  const after = await wc.callTool({ name: "get_task", arguments: { task_id: created.id } });
  assert.ok(after.isError, "deleted task should no longer be fetchable");
});

test("delete_task is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({ name: "delete_task", arguments: { task_id: 1 } });
  assert.ok(result.isError, "delete_task must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("create_label, list_labels, add/remove label round-trip", { skip }, async () => {
  const wc = await getWriteClient(); // remove_label_from_task is delete-tier
  const labelTitle = `e2e label ${process.hrtime.bigint()}`;
  const label = parse(
    await client.callTool({ name: "create_label", arguments: { title: labelTitle, hex_color: "#00ff00" } }),
  );
  assert.ok(Number.isInteger(label.id));
  assert.equal(label.hex_color, "00ff00");

  const labels = parse(await client.callTool({ name: "list_labels", arguments: {} }));
  assert.ok(labels.items.some((l) => l.id === label.id), "created label appears in list_labels");

  // attach to a fresh task, confirm via get_task, then detach
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const task = parse(
    await client.callTool({
      name: "create_task",
      arguments: { project_id: projects.items[0].id, title: `e2e labeled ${process.hrtime.bigint()}` },
    }),
  );
  parse(await client.callTool({ name: "add_label_to_task", arguments: { task_id: task.id, label_id: label.id } }));
  const detail = parse(await client.callTool({ name: "get_task", arguments: { task_id: task.id } }));
  assert.ok(detail.labels?.some((l) => l.id === label.id), "label shows on the task");

  const removed = parse(
    await wc.callTool({ name: "remove_label_from_task", arguments: { task_id: task.id, label_id: label.id } }),
  );
  assert.deepEqual(removed, { ok: true, task_id: task.id, label_id: label.id });
  const after = parse(await client.callTool({ name: "get_task", arguments: { task_id: task.id } }));
  assert.ok(!(after.labels ?? []).some((l) => l.id === label.id), "label detached");
});

test("update_label changes the title while preserving the description (full-replace guard)", { skip }, async () => {
  const wc = await getWriteClient();
  // The MCP neither sets nor returns a label description, but Label.Update writes
  // Cols("title","description","hex_color") unconditionally — so a title-only
  // update used to wipe a description set elsewhere. Seed + read the description
  // straight from Vikunja's REST API to prove the merge carries it through.
  const mk = await vikunjaREST("/labels", {
    method: "PUT",
    body: JSON.stringify({ title: `e2e label ${process.hrtime.bigint()}`, description: "keep me", hex_color: "00ff00" }),
  });
  const label = await mk.json();
  assert.equal(label.description, "keep me", "seeded a label with a description");

  // change only the title via the MCP tool
  parse(await wc.callTool({ name: "update_label", arguments: { label_id: label.id, title: "Renamed label" } }));

  const after = await (await vikunjaREST(`/labels/${label.id}`)).json();
  assert.equal(after.title, "Renamed label", "title changed");
  assert.equal(after.description, "keep me", "description survived a title-only update");
});

test("remove_label_from_task is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({
    name: "remove_label_from_task",
    arguments: { task_id: 1, label_id: 1 },
  });
  assert.ok(result.isError, "delete tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("search_users returns a (possibly empty) user list without error", { skip }, async () => {
  const res = parse(await client.callTool({ name: "search_users", arguments: { query: "a" } }));
  assert.ok(Array.isArray(res.items), "items should be an array");
});

test("assign_user, list_task_assignees, unassign_user round-trip", { skip }, async () => {
  const wc = await getWriteClient(); // unassign_user is delete-tier
  // the bootstrap user is the token owner; find their id via the seeded task's assignee later
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const task = parse(
    await client.callTool({
      name: "create_task",
      arguments: { project_id: projects.items[0].id, title: `e2e assignee ${process.hrtime.bigint()}` },
    }),
  );
  // assign the token owner (user id 1 in the throwaway test instance)
  const userId = 1;
  const assigned = parse(
    await client.callTool({ name: "assign_user", arguments: { task_id: task.id, user_id: userId } }),
  );
  assert.deepEqual(assigned, { ok: true, task_id: task.id, user_id: userId });

  const list = parse(await client.callTool({ name: "list_task_assignees", arguments: { task_id: task.id } }));
  assert.ok(list.items.some((u) => u.id === userId), "assignee shows up");

  const unassigned = parse(
    await wc.callTool({ name: "unassign_user", arguments: { task_id: task.id, user_id: userId } }),
  );
  assert.deepEqual(unassigned, { ok: true, task_id: task.id, user_id: userId });
  const after = parse(await client.callTool({ name: "list_task_assignees", arguments: { task_id: task.id } }));
  assert.ok(!after.items.some((u) => u.id === userId), "assignee removed");
});

test("unassign_user is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({ name: "unassign_user", arguments: { task_id: 1, user_id: 1 } });
  assert.ok(result.isError, "delete tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("add_task_comment, list_task_comments, delete_task_comment round-trip", { skip }, async () => {
  const wc = await getWriteClient(); // delete_task_comment is delete-tier
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const task = parse(
    await client.callTool({
      name: "create_task",
      arguments: { project_id: projects.items[0].id, title: `e2e comment ${process.hrtime.bigint()}` },
    }),
  );
  const text = `hello ${process.hrtime.bigint()}`;
  const added = parse(await client.callTool({ name: "add_task_comment", arguments: { task_id: task.id, comment: text } }));
  assert.equal(added.comment, text);
  assert.ok(Number.isInteger(added.id));

  const list = parse(await client.callTool({ name: "list_task_comments", arguments: { task_id: task.id } }));
  assert.ok(list.items.some((c) => c.id === added.id), "comment appears in list");
  assert.ok(Number.isInteger(list.total_pages) && list.total_pages >= 1, "comments list reports total_pages");

  const deleted = parse(
    await wc.callTool({ name: "delete_task_comment", arguments: { task_id: task.id, comment_id: added.id } }),
  );
  assert.deepEqual(deleted, { ok: true, task_id: task.id, comment_id: added.id });
  const after = parse(await client.callTool({ name: "list_task_comments", arguments: { task_id: task.id } }));
  assert.ok(!after.items.some((c) => c.id === added.id), "comment removed");
});

test("delete_task_comment is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({ name: "delete_task_comment", arguments: { task_id: 1, comment_id: 1 } });
  assert.ok(result.isError, "delete tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("update_task_comment edits an existing comment's text (live)", { skip }, async () => {
  const wc = await getWriteClient(); // update_task_comment is write-tier
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const task = parse(
    await wc.callTool({
      name: "create_task",
      arguments: { project_id: projects.items[0].id, title: `e2e cupd ${process.hrtime.bigint()}` },
    }),
  );
  const added = parse(
    await wc.callTool({ name: "add_task_comment", arguments: { task_id: task.id, comment: "original" } }),
  );
  const newText = `edited ${process.hrtime.bigint()}`;
  const updated = parse(
    await wc.callTool({
      name: "update_task_comment",
      arguments: { task_id: task.id, comment_id: added.id, comment: newText },
    }),
  );
  assert.equal(updated.id, added.id);
  assert.equal(updated.comment, newText, "returned comment reflects the edit");
  // Confirm the edit persisted, not just the echoed response.
  const list = parse(await wc.callTool({ name: "list_task_comments", arguments: { task_id: task.id } }));
  assert.equal(list.items.find((c) => c.id === added.id)?.comment, newText, "edit persisted");
});

test("create_task_relation, list_task_relations, delete_task_relation round-trip", { skip }, async () => {
  const wc = await getWriteClient(); // delete_task_relation is delete-tier
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const pid = projects.items[0].id;
  const mk = async (n) =>
    parse(await client.callTool({ name: "create_task", arguments: { project_id: pid, title: `e2e rel ${n} ${process.hrtime.bigint()}` } }));
  const a = await mk("A");
  const b = await mk("B");

  const created = parse(
    await client.callTool({
      name: "create_task_relation",
      arguments: { task_id: a.id, other_task_id: b.id, relation_kind: "related" },
    }),
  );
  assert.deepEqual(created, { ok: true, task_id: a.id, other_task_id: b.id, relation_kind: "related" });

  const rels = parse(await client.callTool({ name: "list_task_relations", arguments: { task_id: a.id } }));
  assert.ok((rels.relations.related ?? []).some((t) => t.id === b.id), "related task shows up");

  const deleted = parse(
    await wc.callTool({
      name: "delete_task_relation",
      arguments: { task_id: a.id, other_task_id: b.id, relation_kind: "related" },
    }),
  );
  assert.equal(deleted.ok, true);
  const after = parse(await client.callTool({ name: "list_task_relations", arguments: { task_id: a.id } }));
  assert.ok(!(after.relations.related ?? []).some((t) => t.id === b.id), "relation removed");
});

test("delete_task_relation is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({
    name: "delete_task_relation",
    arguments: { task_id: 1, other_task_id: 2, relation_kind: "related" },
  });
  assert.ok(result.isError, "delete tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("upload_task_attachment, list_task_attachments, delete_task_attachment round-trip", { skip }, async () => {
  const wc = await getWriteClient(); // delete_task_attachment is delete-tier
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const task = parse(
    await client.callTool({
      name: "create_task",
      arguments: { project_id: projects.items[0].id, title: `e2e attach ${process.hrtime.bigint()}` },
    }),
  );
  const filename = `note-${process.hrtime.bigint()}.txt`;
  const content = Buffer.from("hello from e2e").toString("base64");
  const up = parse(
    await client.callTool({
      name: "upload_task_attachment",
      arguments: { task_id: task.id, filename, content_base64: content },
    }),
  );
  assert.equal(up.items.length, 1);
  assert.equal(up.items[0].name, filename);
  assert.equal(up.items[0].size, Buffer.byteLength("hello from e2e"));
  const attId = up.items[0].id;

  const list = parse(await client.callTool({ name: "list_task_attachments", arguments: { task_id: task.id } }));
  assert.ok(list.items.some((a) => a.id === attId), "attachment appears in list");

  const del = parse(
    await wc.callTool({ name: "delete_task_attachment", arguments: { task_id: task.id, attachment_id: attId } }),
  );
  assert.deepEqual(del, { ok: true, task_id: task.id, attachment_id: attId });
  const after = parse(await client.callTool({ name: "list_task_attachments", arguments: { task_id: task.id } }));
  assert.ok(!after.items.some((a) => a.id === attId), "attachment removed");
});

test("delete_task_attachment is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({ name: "delete_task_attachment", arguments: { task_id: 1, attachment_id: 1 } });
  assert.ok(result.isError, "delete tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("list_buckets, create_bucket, move_task_to_bucket round-trip", { skip }, async () => {
  const wc = await getWriteClient(); // move_task_to_bucket is write-tier
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const pid = projects.items[0].id;

  const before = parse(await client.callTool({ name: "list_buckets", arguments: { project_id: pid } }));
  assert.ok(Number.isInteger(before.view_id), "resolved a kanban view");
  assert.ok(before.items.length >= 1, "kanban view seeds at least one bucket");

  const bucket = parse(
    await client.callTool({ name: "create_bucket", arguments: { project_id: pid, title: `e2e col ${process.hrtime.bigint()}` } }),
  );
  assert.ok(Number.isInteger(bucket.id));
  assert.equal(bucket.view_id, before.view_id);

  const task = parse(
    await client.callTool({ name: "create_task", arguments: { project_id: pid, title: `e2e kanban ${process.hrtime.bigint()}` } }),
  );
  const moved = parse(
    await wc.callTool({ name: "move_task_to_bucket", arguments: { project_id: pid, bucket_id: bucket.id, task_id: task.id } }),
  );
  assert.deepEqual(moved, { ok: true, project_id: pid, view_id: before.view_id, bucket_id: bucket.id, task_id: task.id });
});

test("update_bucket changes the limit while preserving the title (full-replace guard)", { skip }, async () => {
  const wc = await getWriteClient();
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const pid = projects.items[0].id;
  const title = `e2e bucket ${process.hrtime.bigint()}`;
  const bucket = parse(await wc.callTool({ name: "create_bucket", arguments: { project_id: pid, title } }));

  // Change only the limit — the title must survive (POST bucket is a full replace).
  const updated = parse(
    await wc.callTool({ name: "update_bucket", arguments: { project_id: pid, bucket_id: bucket.id, limit: 5 } }),
  );
  assert.equal(updated.limit, 5, "limit changed");
  assert.equal(updated.title, title, "title preserved across a limit-only update");
});

test("delete_bucket removes a kanban bucket (live)", { skip }, async () => {
  const wc = await getWriteClient(); // delete_bucket is delete-tier
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const pid = projects.items[0].id;
  const bucket = parse(
    await wc.callTool({ name: "create_bucket", arguments: { project_id: pid, title: `e2e delbucket ${process.hrtime.bigint()}` } }),
  );
  const del = parse(await wc.callTool({ name: "delete_bucket", arguments: { project_id: pid, bucket_id: bucket.id } }));
  assert.deepEqual(del, { ok: true, project_id: pid, view_id: bucket.view_id, bucket_id: bucket.id });
  const after = parse(await wc.callTool({ name: "list_buckets", arguments: { project_id: pid } }));
  assert.ok(!after.items.some((b) => b.id === bucket.id), "deleted bucket no longer listed");
});

test("move_task_to_bucket is not callable without the write flag", { skip }, async () => {
  const result = await client.callTool({
    name: "move_task_to_bucket",
    arguments: { project_id: 1, bucket_id: 1, task_id: 1 },
  });
  assert.ok(result.isError, "write tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("create_team then list_teams round-trips (additive + read)", { skip }, async () => {
  const name = `e2e team ${process.hrtime.bigint()}`;
  const team = parse(await client.callTool({ name: "create_team", arguments: { name } }));
  assert.ok(Number.isInteger(team.id));
  assert.equal(team.name, name);
  const teams = parse(await client.callTool({ name: "list_teams", arguments: {} }));
  assert.ok(teams.items.some((t) => t.id === team.id), "created team appears in list_teams");
});

test("team member add / toggle-admin / remove round-trip (username-keyed endpoints)", { skip }, async () => {
  const wc = await getWriteClient(); // toggle is write-tier, remove is delete-tier
  // These three endpoints are keyed on the username, not a numeric id. This test
  // needs a real second user, which is why the bug went uncaught: bootstrap only
  // creates one user, so nothing here previously exercised remove/toggle-admin.
  const member = await registerUser("mcpteammate");
  const team = parse(
    await client.callTool({ name: "create_team", arguments: { name: `e2e team ops ${process.hrtime.bigint()}` } }),
  );

  // add by username
  const added = parse(
    await client.callTool({ name: "add_team_member", arguments: { team_id: team.id, username: member } }),
  );
  assert.equal(added.username, member);
  assert.equal(added.admin, false, "added as a regular member");
  let detail = parse(await client.callTool({ name: "get_team", arguments: { team_id: team.id } }));
  assert.ok(detail.members.some((m) => m.username === member), "member shows up on the team");

  // toggle admin by username — a numeric id here would 404 (looked up as a
  // literal username). Confirm the admin flag actually flipped server-side.
  parse(await wc.callTool({ name: "toggle_team_member_admin", arguments: { team_id: team.id, username: member } }));
  detail = parse(await client.callTool({ name: "get_team", arguments: { team_id: team.id } }));
  assert.ok(detail.members.find((m) => m.username === member)?.admin, "member was promoted to admin");

  // remove by username — same routing; a numeric id would 404.
  const removed = parse(
    await wc.callTool({ name: "remove_team_member", arguments: { team_id: team.id, username: member } }),
  );
  assert.deepEqual(removed, { ok: true, team_id: team.id, username: member });
  detail = parse(await client.callTool({ name: "get_team", arguments: { team_id: team.id } }));
  assert.ok(!detail.members.some((m) => m.username === member), "member removed from the team");
});

test("share_project_with_team and create_link_share succeed", { skip }, async () => {
  const wc = await getWriteClient();
  const team = parse(await client.callTool({ name: "create_team", arguments: { name: `e2e share ${process.hrtime.bigint()}` } }));
  const project = parse(await client.callTool({ name: "create_project", arguments: { title: `e2e shared ${process.hrtime.bigint()}` } }));

  const shared = parse(
    await wc.callTool({
      name: "share_project_with_team",
      arguments: { project_id: project.id, team_id: team.id, permission: 1 },
    }),
  );
  assert.deepEqual(shared, { ok: true, project_id: project.id, team_id: team.id, permission: 1 });

  const link = parse(await wc.callTool({ name: "create_link_share", arguments: { project_id: project.id, permission: 0 } }));
  assert.equal(link.project_id, project.id);
  assert.ok(typeof link.hash === "string" && link.hash.length > 0, "returns a share hash");
});

test("list_notifications returns a (possibly empty) list without error", { skip }, async () => {
  const res = parse(await client.callTool({ name: "list_notifications", arguments: {} }));
  assert.ok(Array.isArray(res.items), "items should be an array");
});

test("create_webhook, list_webhooks, delete_webhook round-trip", { skip }, async () => {
  const wc = await getWriteClient(); // create_webhook is write-tier; delete_webhook is delete-tier
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const pid = projects.items[0].id;
  const url = `https://example.com/hook/${process.hrtime.bigint()}`;
  const created = parse(
    await wc.callTool({
      name: "create_webhook",
      arguments: { project_id: pid, target_url: url, events: ["task.created"], secret: "s3cr3t" },
    }),
  );
  assert.ok(Number.isInteger(created.id));
  assert.equal(created.target_url, url);
  assert.deepEqual(created.events, ["task.created"]);
  assert.ok(!("secret" in created), "the secret is never returned");

  const list = parse(await client.callTool({ name: "list_webhooks", arguments: { project_id: pid } }));
  assert.ok(list.items.some((w) => w.id === created.id), "webhook appears in list");

  // update only the events — target_url must survive (POST webhook is a full replace).
  const updated = parse(
    await wc.callTool({
      name: "update_webhook",
      arguments: { project_id: pid, webhook_id: created.id, events: ["task.created", "task.updated"] },
    }),
  );
  assert.deepEqual(updated.events, ["task.created", "task.updated"], "events changed");
  assert.equal(updated.target_url, url, "target_url preserved across an events-only update");

  const del = parse(await wc.callTool({ name: "delete_webhook", arguments: { project_id: pid, webhook_id: created.id } }));
  assert.deepEqual(del, { ok: true, project_id: pid, webhook_id: created.id });
});

test("create_webhook is not callable without the write flag", { skip }, async () => {
  const result = await client.callTool({
    name: "create_webhook",
    arguments: { project_id: 1, target_url: "https://example.com/hook", events: ["task.created"] },
  });
  assert.ok(result.isError, "egress tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("delete_webhook is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({ name: "delete_webhook", arguments: { project_id: 1, webhook_id: 1 } });
  assert.ok(result.isError, "delete tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("get_current_user returns the token owner", { skip }, async () => {
  const user = parse(await client.callTool({ name: "get_current_user", arguments: {} }));
  assert.ok(Number.isInteger(user.id));
  assert.equal(typeof user.username, "string");
  assert.ok(user.username.length > 0);
});

test("caldav info / token create / delete round-trip (live)", { skip }, async () => {
  const wc = await getWriteClient(); // create_caldav_token is write-tier, delete is delete-tier
  const info = parse(await wc.callTool({ name: "get_caldav_info", arguments: {} }));
  assert.ok(typeof info.dav_base_url === "string" && info.dav_base_url.endsWith("/dav"), "derives the /dav base url");
  assert.ok(typeof info.username === "string" && info.username.length > 0, "reports the caldav username");
  assert.ok(Array.isArray(info.tokens), "existing token metadata is a list");

  const created = parse(await wc.callTool({ name: "create_caldav_token", arguments: {} }));
  assert.ok(Number.isInteger(created.id));
  assert.ok(typeof created.token === "string" && created.token.length > 0, "returns the secret once");

  // The new token shows up in get_caldav_info — and its secret never does.
  const after = parse(await wc.callTool({ name: "get_caldav_info", arguments: {} }));
  const found = after.tokens.find((t) => t.id === created.id);
  assert.ok(found, "created caldav token appears in the info listing");
  assert.ok(!("token" in found), "the secret is never listed");

  const del = parse(await wc.callTool({ name: "delete_caldav_token", arguments: { token_id: created.id } }));
  assert.deepEqual(del, { ok: true, token_id: created.id });
  const afterDel = parse(await wc.callTool({ name: "get_caldav_info", arguments: {} }));
  assert.ok(!afterDel.tokens.some((t) => t.id === created.id), "deleted caldav token no longer listed");
});

test("create_api_token (write-gated) then list_api_tokens (secret returned once, never listed)", { skip }, async () => {
  const wc = await getWriteClient(); // create_api_token is write-tier (credential minting)
  const created = parse(
    await wc.callTool({
      name: "create_api_token",
      arguments: {
        title: `e2e token ${process.hrtime.bigint()}`,
        expires_at: "2030-01-01T00:00:00Z",
        permissions: { tasks: ["read_all"] },
      },
    }),
  );
  assert.ok(Number.isInteger(created.id));
  assert.ok(typeof created.token === "string" && created.token.startsWith("tk_"), "returns the tk_ secret");

  const list = parse(await client.callTool({ name: "list_api_tokens", arguments: {} }));
  const found = list.items.find((t) => t.id === created.id);
  assert.ok(found, "token appears in list_api_tokens");
  assert.ok(!("token" in found), "the secret is never returned in the list");
});

test("create_api_token is not callable without the write flag", { skip }, async () => {
  const result = await client.callTool({
    name: "create_api_token",
    arguments: { title: "x", expires_at: "2030-01-01T00:00:00Z", permissions: { tasks: ["read_all"] } },
  });
  assert.ok(result.isError, "credential-minting must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("subscribe then unsubscribe round-trips a task subscription", { skip }, async () => {
  const wc = await getWriteClient(); // unsubscribe is delete-tier
  const projects = parse(await client.callTool({ name: "list_projects", arguments: {} }));
  const task = parse(
    await client.callTool({ name: "create_task", arguments: { project_id: projects.items[0].id, title: `e2e sub ${process.hrtime.bigint()}` } }),
  );
  const sub = parse(await client.callTool({ name: "subscribe", arguments: { entity: "task", entity_id: task.id } }));
  assert.deepEqual(sub, { ok: true, entity: "task", entity_id: task.id });
  const unsub = parse(await wc.callTool({ name: "unsubscribe", arguments: { entity: "task", entity_id: task.id } }));
  assert.deepEqual(unsub, { ok: true, entity: "task", entity_id: task.id });
});

test("unsubscribe is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({ name: "unsubscribe", arguments: { entity: "task", entity_id: 1 } });
  assert.ok(result.isError, "delete tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("saved filter create/list/update/delete round-trip", { skip }, async () => {
  const wc = await getWriteClient(); // update (write) + delete (delete) are gated
  const title = `e2e filter ${process.hrtime.bigint()}`;
  const created = parse(
    await client.callTool({
      name: "create_saved_filter",
      arguments: { title, filter: "done = false", description: "made in e2e" },
    }),
  );
  assert.ok(Number.isInteger(created.id));

  const list = parse(await client.callTool({ name: "list_saved_filters", arguments: {} }));
  assert.ok(list.items.some((f) => f.id === created.id && f.title === title), "filter appears in list");

  const updated = parse(
    await wc.callTool({
      name: "update_saved_filter",
      arguments: { filter_id: created.id, filter: "priority >= 4" },
    }),
  );
  assert.equal(updated.filter, "priority >= 4");
  assert.equal(updated.description, "made in e2e", "description preserved by fetch-merge");

  const del = parse(await wc.callTool({ name: "delete_saved_filter", arguments: { filter_id: created.id } }));
  assert.deepEqual(del, { ok: true, filter_id: created.id });
  const after = parse(await client.callTool({ name: "list_saved_filters", arguments: {} }));
  assert.ok(!after.items.some((f) => f.id === created.id), "filter removed");
});

test("update_saved_filter is not callable without the write flag", { skip }, async () => {
  const result = await client.callTool({ name: "update_saved_filter", arguments: { filter_id: 1, title: "x" } });
  assert.ok(result.isError, "write tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
});

test("share_project_with_user grants a real user access at the requested permission", { skip }, async () => {
  const wc = await getWriteClient();
  // Needs a real second user — the reason this had no positive coverage before,
  // which is exactly how the user_id-vs-username bug hid. The old test only
  // asserted isError, so it passed even though the tool always 404'd.
  const grantee = await registerUser("mcpsharee");
  const project = parse(
    await client.callTool({ name: "create_project", arguments: { title: `e2e usershare ${process.hrtime.bigint()}` } }),
  );
  const shared = parse(
    await wc.callTool({
      name: "share_project_with_user",
      arguments: { project_id: project.id, username: grantee, permission: 1 },
    }),
  );
  assert.deepEqual(shared, { ok: true, project_id: project.id, username: grantee, permission: 1 });

  // Confirm the grant landed server-side at the requested level (not silently
  // downgraded), read straight from Vikunja's REST API.
  const users = await (await vikunjaREST(`/projects/${project.id}/users`)).json();
  const entry = users.find((u) => u.username === grantee);
  assert.ok(entry, "grantee appears in the project's user shares");
  assert.equal(entry.permission, 1, "granted at read+write, not silently downgraded to read");
});

test("share_project_with_user surfaces a clean error for a nonexistent user", { skip }, async () => {
  const wc = await getWriteClient();
  const project = parse(
    await client.callTool({ name: "create_project", arguments: { title: `e2e usershare err ${process.hrtime.bigint()}` } }),
  );
  const result = await wc.callTool({
    name: "share_project_with_user",
    arguments: { project_id: project.id, username: "definitely-not-a-real-user", permission: 1 },
  });
  assert.ok(result.isError, "sharing with a nonexistent user should error, not crash");
  assert.match(result.content[0].text, /does not exist/i);
});

test("set_task_labels replaces the whole label set (bulk wire shape { labels: [{id}] })", { skip }, async () => {
  const wc = await getWriteClient(); // set_task_labels is write-tier
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const task = parse(
    await wc.callTool({
      name: "create_task",
      arguments: { project_id: projects.items[0].id, title: `e2e setlabels ${process.hrtime.bigint()}` },
    }),
  );
  const mkLabel = async (n) =>
    parse(await wc.callTool({ name: "create_label", arguments: { title: `e2e sl ${n} ${process.hrtime.bigint()}` } }));
  const l1 = await mkLabel("1");
  const l2 = await mkLabel("2");
  const sorted = (ids) => [...ids].sort((a, b) => a - b);

  // Set both labels at once — this is the only place the bulk body shape
  // { labels: [{id}] } (not the singular { label_id } add_label_to_task uses)
  // is exercised against real Vikunja.
  const set = parse(
    await wc.callTool({ name: "set_task_labels", arguments: { task_id: task.id, label_ids: [l1.id, l2.id] } }),
  );
  assert.deepEqual(set, { ok: true, task_id: task.id, label_ids: [l1.id, l2.id] });
  let detail = parse(await wc.callTool({ name: "get_task", arguments: { task_id: task.id } }));
  assert.deepEqual(sorted((detail.labels ?? []).map((l) => l.id)), sorted([l1.id, l2.id]), "both labels attached");

  // Replace with just one — the unlisted label must be removed (full-replace,
  // not additive; that semantic is the tool's documented contract).
  parse(await wc.callTool({ name: "set_task_labels", arguments: { task_id: task.id, label_ids: [l2.id] } }));
  detail = parse(await wc.callTool({ name: "get_task", arguments: { task_id: task.id } }));
  assert.deepEqual((detail.labels ?? []).map((l) => l.id), [l2.id], "only the still-listed label remains");

  // Empty set clears all labels.
  parse(await wc.callTool({ name: "set_task_labels", arguments: { task_id: task.id, label_ids: [] } }));
  detail = parse(await wc.callTool({ name: "get_task", arguments: { task_id: task.id } }));
  assert.ok(!(detail.labels ?? []).length, "empty label_ids clears every label");
});

test("set_task_assignees replaces the whole assignee set (bulk wire shape { assignees: [{id}] })", { skip }, async () => {
  const wc = await getWriteClient(); // set_task_assignees is write-tier
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const task = parse(
    await wc.callTool({
      name: "create_task",
      arguments: { project_id: projects.items[0].id, title: `e2e setassignees ${process.hrtime.bigint()}` },
    }),
  );
  const userId = 1; // token owner in the throwaway instance (see the assign_user round-trip)

  // Exercises POST /tasks/{id}/assignees/bulk with { assignees: [{id}] }.
  const set = parse(
    await wc.callTool({ name: "set_task_assignees", arguments: { task_id: task.id, user_ids: [userId] } }),
  );
  assert.deepEqual(set, { ok: true, task_id: task.id, user_ids: [userId] });
  let list = parse(await wc.callTool({ name: "list_task_assignees", arguments: { task_id: task.id } }));
  assert.ok(list.items.some((u) => u.id === userId), "assignee set via bulk shows up");

  // Empty set unassigns everyone.
  parse(await wc.callTool({ name: "set_task_assignees", arguments: { task_id: task.id, user_ids: [] } }));
  list = parse(await wc.callTool({ name: "list_task_assignees", arguments: { task_id: task.id } }));
  assert.ok(!list.items.some((u) => u.id === userId), "empty user_ids unassigns everyone");
});

test("bulk_update_tasks applies one change set to multiple tasks (POST /tasks/bulk)", { skip }, async () => {
  const wc = await getWriteClient(); // bulk_update_tasks is write-tier
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const pid = projects.items[0].id; // all task_ids must share a project
  const mk = async (n) =>
    parse(
      await wc.callTool({
        name: "create_task",
        arguments: { project_id: pid, title: `e2e bulk ${n} ${process.hrtime.bigint()}` },
      }),
    );
  const a = await mk("A");
  const b = await mk("B");

  // A single POST /tasks/bulk { task_ids, done, priority } must land on BOTH
  // tasks — verifies the flat bulk body shape and that the change fans out.
  const res = parse(
    await wc.callTool({
      name: "bulk_update_tasks",
      arguments: { task_ids: [a.id, b.id], done: true, priority: 3 },
    }),
  );
  assert.deepEqual(res, { ok: true, task_ids: [a.id, b.id] });

  for (const id of [a.id, b.id]) {
    const detail = parse(await wc.callTool({ name: "get_task", arguments: { task_id: id } }));
    assert.equal(detail.done, true, `task ${id} marked done by the bulk update`);
    assert.equal(detail.priority, 3, `task ${id} priority set by the bulk update`);
  }
});

test("invalid project_id surfaces a tool error, not a crash", { skip }, async () => {
  const result = await client.callTool({ name: "list_tasks", arguments: { project_id: -1 } });
  assert.ok(result.isError, "expected isError for a bad project_id");
  assert.match(result.content[0].text, /positive integer/);
});

test("empty title is rejected before hitting Vikunja", { skip }, async () => {
  const result = await client.callTool({
    name: "create_task",
    arguments: { project_id: 1, title: "   " },
  });
  assert.ok(result.isError, "expected isError for a blank title");
  assert.match(result.content[0].text, /must not be empty/);
});

test("unknown tool names are rejected", { skip }, async () => {
  const result = await client.callTool({ name: "delete_everything", arguments: {} });
  assert.ok(result.isError, "unknown tools must error");
  assert.match(result.content[0].text, /Unknown tool/);
});

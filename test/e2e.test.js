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
    "assign_user",
    "create_bucket",
    "create_label",
    "create_project",
    "create_task",
    "create_task_relation",
    "get_project",
    "get_task",
    "list_all_tasks",
    "list_buckets",
    "list_labels",
    "list_projects",
    "list_task_assignees",
    "list_task_attachments",
    "list_task_comments",
    "list_task_relations",
    "list_tasks",
    "search_users",
    "upload_task_attachment",
  ]);
  for (const gated of [
    "update_task",
    "set_task_done",
    "update_project",
    "archive_project",
    "delete_project",
    "remove_label_from_task",
    "unassign_user",
    "delete_task_comment",
    "delete_task_relation",
    "delete_task_attachment",
    "move_task_to_bucket",
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
      arguments: { filter: "done = false", sort_by: "id", order_by: "desc" },
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

test("update_task changes only the provided fields", { skip }, async () => {
  const wc = await getWriteClient();
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const created = parse(
    await wc.callTool({
      name: "create_task",
      arguments: { project_id: projects.items[0].id, title: `e2e update ${process.hrtime.bigint()}` },
    }),
  );
  const updated = parse(
    await wc.callTool({
      name: "update_task",
      arguments: { task_id: created.id, priority: 5, description: "edited" },
    }),
  );
  assert.equal(updated.id, created.id);
  assert.equal(updated.priority, 5);
  assert.equal(updated.description, "edited");
});

test("set_task_done marks a task done then reopens it", { skip }, async () => {
  const wc = await getWriteClient();
  const projects = parse(await wc.callTool({ name: "list_projects", arguments: {} }));
  const created = parse(
    await wc.callTool({
      name: "create_task",
      arguments: { project_id: projects.items[0].id, title: `e2e done ${process.hrtime.bigint()}` },
    }),
  );
  const done = parse(await wc.callTool({ name: "set_task_done", arguments: { task_id: created.id } }));
  assert.equal(done.done, true);
  const reopened = parse(
    await wc.callTool({ name: "set_task_done", arguments: { task_id: created.id, done: false } }),
  );
  assert.equal(reopened.done, false);
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

test("update_project and archive_project change fields (write)", { skip }, async () => {
  const wc = await getWriteClient();
  const created = parse(
    await wc.callTool({ name: "create_project", arguments: { title: `e2e proj upd ${process.hrtime.bigint()}` } }),
  );
  const renamed = parse(
    await wc.callTool({ name: "update_project", arguments: { project_id: created.id, title: "Renamed E2E" } }),
  );
  assert.equal(renamed.title, "Renamed E2E");
  const archived = parse(await wc.callTool({ name: "archive_project", arguments: { project_id: created.id } }));
  assert.equal(archived.is_archived, true);
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
  assert.deepEqual(res, { id: created.id, deleted: true });
  // it should be gone now
  const after = await wc.callTool({ name: "get_project", arguments: { project_id: created.id } });
  assert.ok(after.isError, "deleted project should no longer be fetchable");
});

test("delete_project is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({ name: "delete_project", arguments: { project_id: 1 } });
  assert.ok(result.isError, "delete tool must be gated off by default");
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
  assert.deepEqual(removed, { task_id: task.id, label_id: label.id, removed: true });
  const after = parse(await client.callTool({ name: "get_task", arguments: { task_id: task.id } }));
  assert.ok(!(after.labels ?? []).some((l) => l.id === label.id), "label detached");
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
  assert.ok(Array.isArray(res.users), "users should be an array");
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
  assert.deepEqual(assigned, { task_id: task.id, user_id: userId, assigned: true });

  const list = parse(await client.callTool({ name: "list_task_assignees", arguments: { task_id: task.id } }));
  assert.ok(list.assignees.some((u) => u.id === userId), "assignee shows up");

  const unassigned = parse(
    await wc.callTool({ name: "unassign_user", arguments: { task_id: task.id, user_id: userId } }),
  );
  assert.deepEqual(unassigned, { task_id: task.id, user_id: userId, unassigned: true });
  const after = parse(await client.callTool({ name: "list_task_assignees", arguments: { task_id: task.id } }));
  assert.ok(!after.assignees.some((u) => u.id === userId), "assignee removed");
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
  assert.deepEqual(deleted, { task_id: task.id, comment_id: added.id, deleted: true });
  const after = parse(await client.callTool({ name: "list_task_comments", arguments: { task_id: task.id } }));
  assert.ok(!after.items.some((c) => c.id === added.id), "comment removed");
});

test("delete_task_comment is not callable without the delete flag", { skip }, async () => {
  const result = await client.callTool({ name: "delete_task_comment", arguments: { task_id: 1, comment_id: 1 } });
  assert.ok(result.isError, "delete tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
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
  assert.deepEqual(created, { task_id: a.id, other_task_id: b.id, relation_kind: "related", created: true });

  const rels = parse(await client.callTool({ name: "list_task_relations", arguments: { task_id: a.id } }));
  assert.ok((rels.relations.related ?? []).some((t) => t.id === b.id), "related task shows up");

  const deleted = parse(
    await wc.callTool({
      name: "delete_task_relation",
      arguments: { task_id: a.id, other_task_id: b.id, relation_kind: "related" },
    }),
  );
  assert.equal(deleted.deleted, true);
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
  assert.equal(up.uploaded.length, 1);
  assert.equal(up.uploaded[0].name, filename);
  assert.equal(up.uploaded[0].size, Buffer.byteLength("hello from e2e"));
  const attId = up.uploaded[0].id;

  const list = parse(await client.callTool({ name: "list_task_attachments", arguments: { task_id: task.id } }));
  assert.ok(list.items.some((a) => a.id === attId), "attachment appears in list");

  const del = parse(
    await wc.callTool({ name: "delete_task_attachment", arguments: { task_id: task.id, attachment_id: attId } }),
  );
  assert.deepEqual(del, { task_id: task.id, attachment_id: attId, deleted: true });
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
  assert.ok(before.buckets.length >= 1, "kanban view seeds at least one bucket");

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
  assert.deepEqual(moved, { project_id: pid, view_id: before.view_id, bucket_id: bucket.id, task_id: task.id, moved: true });
});

test("move_task_to_bucket is not callable without the write flag", { skip }, async () => {
  const result = await client.callTool({
    name: "move_task_to_bucket",
    arguments: { project_id: 1, bucket_id: 1, task_id: 1 },
  });
  assert.ok(result.isError, "write tool must be gated off by default");
  assert.match(result.content[0].text, /Unknown tool/);
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

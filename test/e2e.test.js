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

let client;
let transport;

before(async () => {
  if (!hasEnv) return;
  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: process.env,
    stderr: "inherit",
  });
  client = new Client({ name: "vikunja-mcp-e2e", version: "0.1.0" });
  await client.connect(transport);
});

after(async () => {
  if (client) await client.close();
});

test("exposes exactly the read + additive tool set", { skip }, async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["create_task", "list_projects", "list_tasks"]);
});

test("enabling write/delete flags never drops the default read+additive tools", { skip }, async () => {
  // Spawn a second server with both gates open and confirm the default tools
  // still appear (a superset). No write/delete tools ship yet, so today the
  // sets match; this locks in the invariant so gated tools can only ever be
  // added, never accidentally hide the read+additive baseline.
  const gated = new StdioClientTransport({
    command: "node",
    args: [SERVER],
    env: { ...process.env, VIKUNJA_MCP_ALLOW_WRITE: "1", VIKUNJA_MCP_ALLOW_DELETE: "1" },
    stderr: "inherit",
  });
  const gatedClient = new Client({ name: "vikunja-mcp-e2e-gated", version: "0.1.0" });
  await gatedClient.connect(gated);
  try {
    const names = new Set((await gatedClient.listTools()).tools.map((t) => t.name));
    for (const base of ["create_task", "list_projects", "list_tasks"]) {
      assert.ok(names.has(base), `${base} should remain exposed with flags set`);
    }
  } finally {
    await gatedClient.close();
  }
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

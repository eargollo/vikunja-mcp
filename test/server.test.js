// Unit tests for server.js — config resolution and the request-handler logic,
// extracted from index.js so they run in-process (no subprocess, no Vikunja).
// The tools/call SUCCESS path (structuredContent) and the annotation mapping,
// which index.js could only reach against a live server, are covered here with
// plain fakes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveConfig, listToolsResult, runTool, createServer } from "../server.js";

test("resolveConfig returns base/token/gate for valid env (trailing slash stripped)", () => {
  const cfg = resolveConfig({
    VIKUNJA_URL: "http://host:3456/api/v1/",
    VIKUNJA_API_TOKEN: "tk",
    VIKUNJA_MCP_ALLOW_WRITE: "1",
  });
  assert.deepEqual(cfg, {
    base: "http://host:3456/api/v1",
    token: "tk",
    gate: { allowWrite: true, allowDelete: false },
  });
});

test("resolveConfig defaults both gate flags off when unset", () => {
  const cfg = resolveConfig({ VIKUNJA_URL: "https://host/api/v1", VIKUNJA_API_TOKEN: "tk" });
  assert.deepEqual(cfg.gate, { allowWrite: false, allowDelete: false });
});

test("resolveConfig honours the delete flag independently", () => {
  const cfg = resolveConfig({
    VIKUNJA_URL: "https://host/api/v1",
    VIKUNJA_API_TOKEN: "tk",
    VIKUNJA_MCP_ALLOW_DELETE: "true",
  });
  assert.deepEqual(cfg.gate, { allowWrite: false, allowDelete: true });
});

test("resolveConfig throws on a missing or non-http URL (before checking the token)", () => {
  assert.throws(() => resolveConfig({ VIKUNJA_API_TOKEN: "tk" }), /VIKUNJA_URL must be an absolute URL/);
  assert.throws(() => resolveConfig({ VIKUNJA_URL: "ftp://host/api", VIKUNJA_API_TOKEN: "tk" }), /http or https/);
});

test("resolveConfig throws when the token is missing", () => {
  assert.throws(() => resolveConfig({ VIKUNJA_URL: "http://host/api/v1" }), /set VIKUNJA_API_TOKEN/);
});

test("listToolsResult maps name/title/description/inputSchema and tier annotations", () => {
  const tools = [
    { name: "list_projects", description: "d1", inputSchema: { type: "object" }, tier: "read" },
    { name: "delete_task", description: "d2", inputSchema: { type: "object" }, tier: "delete" },
  ];
  const { tools: mapped } = listToolsResult(tools);
  assert.deepEqual(mapped[0], {
    name: "list_projects",
    title: "List Projects",
    description: "d1",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false },
  });
  assert.equal(mapped[1].title, "Delete Task");
  assert.deepEqual(mapped[1].annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  });
});

test("runTool runs the named tool and returns text + structuredContent", async () => {
  const tools = [{ name: "get_thing", run: async (args) => ({ ok: true, got: args.id }) }];
  const res = await runTool(tools, { name: "get_thing", arguments: { id: 5 } });
  assert.equal(res.isError, undefined);
  assert.deepEqual(res.structuredContent, { ok: true, got: 5 });
  assert.deepEqual(JSON.parse(res.content[0].text), { ok: true, got: 5 });
});

test("runTool defaults missing arguments to an empty object", async () => {
  const seen = [];
  const tools = [{ name: "no_args", run: async (args) => (seen.push(args), { ok: true }) }];
  await runTool(tools, { name: "no_args" });
  assert.deepEqual(seen, [{}]);
});

test("runTool maps an unknown tool name to an isError result", async () => {
  const res = await runTool([], { name: "nope", arguments: {} });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /Unknown tool: nope/);
});

test("runTool maps a thrown handler error to an isError result", async () => {
  const tools = [{ name: "boom", run: async () => { throw new Error("kaboom"); } }];
  const res = await runTool(tools, { name: "boom", arguments: {} });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /Error: kaboom/);
});

test("createServer builds a Server with both request handlers registered", () => {
  const server = createServer({ tools: [], version: "9.9.9" });
  assert.ok(server && typeof server.setRequestHandler === "function", "returns a Server instance");
});

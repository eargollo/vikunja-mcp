// Entry-point tests for index.js — the executable shell. index.js can only be
// exercised as a subprocess (importing it would connect a stdio transport in the
// test process), so these spawn it: to assert the startup guards exit(1) with a
// clear message, and to drive it over stdio with a fake URL/token to confirm it
// boots, gates tools by tier, and round-trips a tools/call. The handler LOGIC
// (config resolution, list/call mapping) is unit-tested in server.test.js; this
// file is the integration check that index.js wires it together. Runs OFFLINE
// and always (not behind VIKUNJA_URL): the guards exit before any network, and
// the handshake + tools/list + validation-reject calls never reach Vikunja.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "index.js");

// Fake — never contacted. Startup validates the URL's shape and connects the
// stdio transport; Vikunja is only reached when a tool's handler runs.
const FAKE_URL = "http://vikunja.invalid/api/v1";
const FAKE_TOKEN = "tk_fake";

// A base env with our config vars stripped, so each case sets exactly what it
// means to test (and a VIKUNJA_URL in the caller's shell can't leak in).
function baseEnv() {
  const env = { ...process.env };
  delete env.VIKUNJA_URL;
  delete env.VIKUNJA_API_TOKEN;
  delete env.VIKUNJA_MCP_ALLOW_WRITE;
  delete env.VIKUNJA_MCP_ALLOW_DELETE;
  return env;
}

// --- Startup guards: index.js must exit(1) with a clear stderr message --------
// spawnSync is fine here because every guard case exits immediately; the happy
// path (which blocks on stdio) is driven with the MCP client below instead.

function startServer(overrides) {
  return spawnSync(process.execPath, [SERVER], {
    env: { ...baseEnv(), ...overrides },
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("index.js exits 1 when VIKUNJA_URL is unset", () => {
  const r = startServer({}); // no URL, no token
  assert.equal(r.status, 1);
  assert.match(r.stderr, /VIKUNJA_URL must be an absolute URL/);
});

test("index.js exits 1 on an unparseable VIKUNJA_URL", () => {
  const r = startServer({ VIKUNJA_URL: "not a url", VIKUNJA_API_TOKEN: FAKE_TOKEN });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /absolute URL/);
});

test("index.js exits 1 on a non-http VIKUNJA_URL scheme", () => {
  const r = startServer({ VIKUNJA_URL: "ftp://host/api/v1", VIKUNJA_API_TOKEN: FAKE_TOKEN });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /http or https/);
});

test("index.js exits 1 when VIKUNJA_API_TOKEN is unset", () => {
  const r = startServer({ VIKUNJA_URL: FAKE_URL }); // valid url, no token
  assert.equal(r.status, 1);
  assert.match(r.stderr, /set VIKUNJA_API_TOKEN/);
});

// --- Server wiring: boot with valid config, then exercise the handlers --------

function spawnClient(name, extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: { ...baseEnv(), VIKUNJA_URL: FAKE_URL, VIKUNJA_API_TOKEN: FAKE_TOKEN, ...extraEnv },
    stderr: "ignore",
  });
  return { client: new Client({ name, version: "0.0.0" }), transport };
}

let client; // default gating (no flags)
let writeClient; // both write + delete flags on

before(async () => {
  const d = spawnClient("index-test-default");
  client = d.client;
  await client.connect(d.transport);
  const w = spawnClient("index-test-write", {
    VIKUNJA_MCP_ALLOW_WRITE: "1",
    VIKUNJA_MCP_ALLOW_DELETE: "1",
  });
  writeClient = w.client;
  await writeClient.connect(w.transport);
});

after(async () => {
  if (client) await client.close();
  if (writeClient) await writeClient.close();
});

test("boots with valid config and gates write/delete tools off by default", async () => {
  const names = new Set((await client.listTools()).tools.map((t) => t.name));
  assert.ok(names.has("list_projects"), "read tool exposed");
  assert.ok(names.has("create_task"), "additive tool exposed");
  assert.ok(!names.has("update_task"), "write tool gated off by default");
  assert.ok(!names.has("delete_task"), "delete tool gated off by default");
});

test("VIKUNJA_MCP_ALLOW_WRITE / _ALLOW_DELETE expose the gated tools", async () => {
  const names = new Set((await writeClient.listTools()).tools.map((t) => t.name));
  assert.ok(names.has("update_task"), "write tool exposed with the flag");
  assert.ok(names.has("delete_task"), "delete tool exposed with the flag");
  // The baseline must not disappear when flags are set.
  assert.ok(names.has("list_projects") && names.has("create_task"), "baseline still exposed");
});

test("callTool maps a pre-network validation failure to an isError result", async () => {
  // get_task validates task_id before any api() call, so this exercises the
  // handler's try/catch -> { isError: true } mapping without touching Vikunja.
  const res = await client.callTool({ name: "get_task", arguments: { task_id: 0 } });
  assert.ok(res.isError, "validation failure surfaces as a tool error");
  assert.match(res.content[0].text, /positive integer/);
});

test("callTool rejects an unknown tool name", async () => {
  const res = await client.callTool({ name: "delete_everything", arguments: {} });
  assert.ok(res.isError, "unknown tool names error");
  assert.match(res.content[0].text, /Unknown tool/);
});

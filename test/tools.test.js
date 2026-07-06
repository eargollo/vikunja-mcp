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

test("the currently shipped tools are read/additive only", () => {
  const tiers = Object.fromEntries(buildTools({ api: noop }).map((t) => [t.name, t.tier]));
  assert.deepEqual(tiers, {
    list_projects: "read",
    list_tasks: "read",
    create_task: "additive",
  });
});

test("the real registration filter gates write/delete tiers behind their flags", () => {
  // Mirrors index.js exactly: buildTools(...).filter(t => tierAllowed(t.tier, gate)).
  // buildTools ships only read/additive today, so inject synthetic gated tools
  // to prove the filter drops them by default and admits them per-flag.
  const registry = [
    ...buildTools({ api: noop }),
    { name: "update_task", tier: "write" },
    { name: "delete_task", tier: "delete" },
  ];
  const exposed = (gate) => registry.filter((t) => tierAllowed(t.tier, gate)).map((t) => t.name);

  assert.deepEqual(
    exposed({ allowWrite: false, allowDelete: false }).sort(),
    ["create_task", "list_projects", "list_tasks"],
    "default install exposes read+additive only",
  );
  assert.ok(exposed({ allowWrite: true, allowDelete: false }).includes("update_task"));
  assert.ok(!exposed({ allowWrite: true, allowDelete: false }).includes("delete_task"));
  assert.ok(exposed({ allowWrite: false, allowDelete: true }).includes("delete_task"));
  assert.ok(!exposed({ allowWrite: false, allowDelete: true }).includes("update_task"));
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

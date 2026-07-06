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
    create_task: "additive",
    update_task: "write",
    set_task_done: "write",
  });
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
    { name: "update_task", tier: "write" },
    { name: "delete_task", tier: "delete" },
  ];
  const exposed = (gate) => registry.filter((t) => tierAllowed(t.tier, gate)).map((t) => t.name);

  assert.deepEqual(
    exposed({ allowWrite: false, allowDelete: false }).sort(),
    ["create_task", "get_task", "list_all_tasks", "list_projects", "list_tasks"],
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

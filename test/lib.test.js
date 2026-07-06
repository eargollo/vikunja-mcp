// Unit tests for the pure helpers in lib.js. No network, no server — runs with
// the built-in Node test runner (`node --test`), zero extra dependencies.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  requireAbsoluteUrl,
  requireProjectId,
  requireTitle,
  optionalPage,
  optionalPerPage,
  buildQuery,
  paginatedResult,
  flagEnabled,
  tierAllowed,
} from "../lib.js";

test("requireAbsoluteUrl accepts http/https and strips trailing slashes", () => {
  assert.equal(requireAbsoluteUrl("http://host:3456/api/v1", "VIKUNJA_URL"), "http://host:3456/api/v1");
  assert.equal(requireAbsoluteUrl("https://host/api/v1/", "VIKUNJA_URL"), "https://host/api/v1");
  assert.equal(requireAbsoluteUrl("http://host/api/v1///", "VIKUNJA_URL"), "http://host/api/v1");
});

test("requireAbsoluteUrl rejects unparseable and non-http URLs", () => {
  assert.throws(() => requireAbsoluteUrl("not a url", "VIKUNJA_URL"), /absolute URL/);
  assert.throws(() => requireAbsoluteUrl("/api/v1", "VIKUNJA_URL"), /absolute URL/);
  assert.throws(() => requireAbsoluteUrl(undefined, "VIKUNJA_URL"), /absolute URL/);
  // "host:3456/..." parses with protocol "host:", so it fails the scheme check.
  assert.throws(() => requireAbsoluteUrl("host:3456/api/v1", "VIKUNJA_URL"), /http or https/);
  assert.throws(() => requireAbsoluteUrl("ftp://host/api", "VIKUNJA_URL"), /http or https/);
  assert.throws(() => requireAbsoluteUrl("file:///etc/passwd", "VIKUNJA_URL"), /http or https/);
});

test("requireProjectId accepts positive integers, coerces numeric strings", () => {
  assert.equal(requireProjectId(1), 1);
  assert.equal(requireProjectId("42"), 42);
});

test("requireProjectId rejects zero, negatives, and non-integers", () => {
  for (const bad of [0, -1, 1.5, "abc", "", null, undefined, NaN]) {
    assert.throws(() => requireProjectId(bad), /positive integer/, `should reject ${String(bad)}`);
  }
});

test("requireTitle trims and requires a non-empty string", () => {
  assert.equal(requireTitle("  hello  "), "hello");
  assert.equal(requireTitle("task"), "task");
});

test("requireTitle rejects empty, whitespace-only, and non-strings", () => {
  assert.throws(() => requireTitle(""), /must not be empty/);
  assert.throws(() => requireTitle("   "), /must not be empty/);
  assert.throws(() => requireTitle(123), /must be a string/);
  assert.throws(() => requireTitle(null), /must be a string/);
  assert.throws(() => requireTitle(undefined), /must be a string/);
});

test("optionalPage returns undefined when omitted, else a positive integer", () => {
  assert.equal(optionalPage(undefined), undefined);
  assert.equal(optionalPage(1), 1);
  assert.equal(optionalPage("3"), 3);
  assert.throws(() => optionalPage(0), /positive integer/);
  assert.throws(() => optionalPage(-2), /positive integer/);
  assert.throws(() => optionalPage(2.5), /positive integer/);
});

test("optionalPerPage enforces the 1-100 range", () => {
  assert.equal(optionalPerPage(undefined), undefined);
  assert.equal(optionalPerPage(1), 1);
  assert.equal(optionalPerPage(100), 100);
  assert.equal(optionalPerPage("50"), 50);
  assert.throws(() => optionalPerPage(0), /between 1 and 100/);
  assert.throws(() => optionalPerPage(101), /between 1 and 100/);
  assert.throws(() => optionalPerPage(2.5), /between 1 and 100/);
});

test("buildQuery omits undefined values and encodes the rest", () => {
  assert.equal(buildQuery({ page: undefined, per_page: undefined }), "");
  assert.equal(buildQuery({ page: 2 }), "?page=2");
  assert.equal(buildQuery({ page: 2, per_page: 50 }), "?page=2&per_page=50");
  assert.equal(buildQuery({ page: undefined, per_page: 10 }), "?per_page=10");
});

test("paginatedResult wraps items with page/count and uses the header page count", () => {
  const headers = new Headers({ "x-pagination-total-pages": "7" });
  const result = paginatedResult([{ id: 1 }, { id: 2 }], 1, 50, headers);
  assert.deepEqual(result, {
    page: 1,
    per_page: 50,
    total_pages: 7,
    count: 2,
    items: [{ id: 1 }, { id: 2 }],
  });
});

test("paginatedResult omits per_page and total_pages when unavailable", () => {
  const headers = new Headers();
  const result = paginatedResult([], 1, undefined, headers);
  assert.deepEqual(result, { page: 1, count: 0, items: [] });
});

test("paginatedResult tolerates a missing headers object", () => {
  const result = paginatedResult([{ id: 9 }], 3, undefined, undefined);
  assert.deepEqual(result, { page: 3, count: 1, items: [{ id: 9 }] });
});

test("flagEnabled treats 1/true/yes/on (any case, trimmed) as enabled", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on", " 1 ", "On"]) {
    assert.equal(flagEnabled(v), true, `should enable ${JSON.stringify(v)}`);
  }
});

test("flagEnabled treats everything else as disabled", () => {
  for (const v of [undefined, null, "", "0", "false", "no", "off", "2", "x"]) {
    assert.equal(flagEnabled(v), false, `should disable ${JSON.stringify(v)}`);
  }
});

test("tierAllowed: read/additive always on; write/delete need their flag", () => {
  const off = { allowWrite: false, allowDelete: false };
  assert.equal(tierAllowed("read", off), true);
  assert.equal(tierAllowed("additive", off), true);
  assert.equal(tierAllowed("write", off), false);
  assert.equal(tierAllowed("delete", off), false);
  assert.equal(tierAllowed("write", { allowWrite: true, allowDelete: false }), true);
  assert.equal(tierAllowed("delete", { allowWrite: false, allowDelete: true }), true);
});

test("tierAllowed defaults to gated when flags are omitted", () => {
  assert.equal(tierAllowed("write"), false);
  assert.equal(tierAllowed("delete"), false);
  assert.equal(tierAllowed("read"), true);
});

test("tierAllowed hides unknown/typo tiers even with both flags on (fail safe)", () => {
  const open = { allowWrite: true, allowDelete: true };
  assert.equal(tierAllowed("wrtie", open), false);
  assert.equal(tierAllowed("admin", open), false);
  assert.equal(tierAllowed(undefined, open), false);
});

test("tierAllowed filters a synthetic tool list by env flags", () => {
  const tools = [
    { name: "r", tier: "read" },
    { name: "a", tier: "additive" },
    { name: "w", tier: "write" },
    { name: "d", tier: "delete" },
  ];
  const names = (flags) => tools.filter((t) => tierAllowed(t.tier, flags)).map((t) => t.name);
  assert.deepEqual(names({ allowWrite: false, allowDelete: false }), ["r", "a"]);
  assert.deepEqual(names({ allowWrite: true, allowDelete: false }), ["r", "a", "w"]);
  assert.deepEqual(names({ allowWrite: false, allowDelete: true }), ["r", "a", "d"]);
  assert.deepEqual(names({ allowWrite: true, allowDelete: true }), ["r", "a", "w", "d"]);
});

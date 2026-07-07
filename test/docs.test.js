// Guards the README against drifting from the actual tool set. The Tools table
// is the public catalog; adding or renaming a tool in tools.js without updating
// README (or leaving a stale row behind) fails these tests. This is what would
// have caught the 1.0.0 table gap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildTools } from "../tools.js";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const TEST_BASE = "http://vikunja.test/api/v1";
const noop = async () => ({ data: null, headers: new Headers() });

// Tool names documented as Tools-table rows: | `tool_name` | tier | endpoint |
// (the env/coverage tables use upper-case or un-backticked first cells, so they
// don't match this pattern).
const documented = new Set(
  [...README.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]),
);
const shipped = new Set(
  buildTools({ api: noop, base: TEST_BASE }).map((t) => t.name),
);

test("README Tools table documents every shipped tool", () => {
  const missing = [...shipped].filter((n) => !documented.has(n)).sort();
  assert.deepEqual(missing, [], `undocumented tools: ${missing.join(", ")}`);
});

test("README Tools table has no row for a tool that no longer ships", () => {
  const stale = [...documented].filter((n) => !shipped.has(n)).sort();
  assert.deepEqual(stale, [], `stale table rows: ${stale.join(", ")}`);
});

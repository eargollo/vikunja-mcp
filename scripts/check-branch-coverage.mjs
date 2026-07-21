// Per-file branch-coverage floor gate.
//
// Node's `--test-coverage-branches` threshold (enforced by `npm run
// test:coverage`) is GLOBAL: a file with low branch coverage can hide behind
// well-covered files as long as the weighted average clears the bar. `tools.js`
// — where every handler's logic lives — sat several points under the 90% global
// gate, propped up by the near-100% pure helpers in `lib.js`/`api.js`. If its
// branch coverage decayed further, the average would still pass.
//
// This enforces a floor on EACH source file's branch coverage, using the exact
// `coveredBranchPercent` Node reports in its own coverage table (via the
// programmatic test runner), and fails the build if any file drops below its
// floor — or if any test fails.
//
// Ratchet policy: when a file's branch coverage improves, raise its floor to
// lock the gain in. Never lower a floor without a comment saying why. A source
// file not listed in FLOORS must clear DEFAULT_FLOOR.

import { run } from "node:test";
import { globSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// Repo-relative source path -> minimum acceptable branch coverage (%).
// Every source file is fully branch-covered today, so each is pinned at 100 and
// the ratchet keeps it there — a new uncovered branch fails the build and names
// the file. index.js's coverage is aggregated from the subprocess tests in
// test/index.test.js (guards + a fake-config boot); the rest is in-process. A
// new source file not listed here must clear DEFAULT_FLOOR.
const FLOORS = {
  "api.js": 100,
  "index.js": 100,
  "lib.js": 100,
  "server.js": 100,
  "tools.js": 100,
};
const DEFAULT_FLOOR = 90;

const testFiles = globSync("test/*.test.js");
if (testFiles.length === 0) {
  console.error("check-branch-coverage: found no test files (test/*.test.js)");
  process.exit(1);
}

const stream = run({
  files: testFiles,
  coverage: true,
  coverageExcludeGlobs: ["test/**"], // instrument the sources, not the tests
});

const failedTests = [];
let summary = null;

for await (const event of stream) {
  if (event.type === "test:fail") {
    // Skipped/todo tests surface as test:pass, so anything here is a real
    // failure. Nested suites aren't used in this repo, so no double-counting.
    failedTests.push(event.data.name);
  } else if (event.type === "test:coverage") {
    summary = event.data.summary;
  }
}

if (failedTests.length > 0) {
  console.error(`\n✖ ${failedTests.length} test(s) failed:`);
  for (const name of failedTests) console.error(`  - ${name}`);
  process.exit(1);
}

if (!summary) {
  console.error("check-branch-coverage: no coverage summary was emitted");
  process.exit(1);
}

const rows = summary.files
  .map((f) => ({ file: path.relative(process.cwd(), f.path), branch: f.coveredBranchPercent }))
  .filter((r) => r.file.endsWith(".js") && !r.file.startsWith(`test${path.sep}`))
  .sort((a, b) => a.file.localeCompare(b.file));

const violations = [];
const width = Math.max(...rows.map((r) => r.file.length), 8);

console.log("Per-file branch-coverage floors:");
for (const { file, branch } of rows) {
  const floor = FLOORS[file] ?? DEFAULT_FLOOR;
  const ok = branch >= floor;
  if (!ok) violations.push({ file, branch, floor });
  console.log(
    `  ${file.padEnd(width)}  ${branch.toFixed(2).padStart(6)}%  (floor ${String(floor).padStart(3)})  ${ok ? "ok" : "BELOW FLOOR"}`,
  );
}

if (violations.length > 0) {
  console.error(
    `\n✖ branch coverage below per-file floor: ${violations
      .map((v) => `${v.file} ${v.branch.toFixed(2)}% < ${v.floor}%`)
      .join(", ")}`,
  );
  console.error("Add tests to cover the missing branches, or adjust the floor in scripts/check-branch-coverage.mjs with a reason.");
  process.exit(1);
}

console.log("\n✔ every source file meets its branch-coverage floor");

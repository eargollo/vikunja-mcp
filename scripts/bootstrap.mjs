#!/usr/bin/env node
// Bootstrap the local test environment.
//
// Waits for the docker-compose Vikunja to come up, registers a throwaway test
// user (idempotent — reuses it on re-run), logs in, and writes a working .env
// with VIKUNJA_URL + a bearer token the MCP server can use.
//
// No dependencies: built-in fetch only. Vikunja accepts the login JWT as a
// `Bearer` token, which is exactly what index.js sends — so for a test box we
// skip the scoped `tk_` API-token dance and use the session token directly.
// (In production, use a real scoped API token instead.)

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, "..", ".env");

const BASE = process.env.VIKUNJA_URL ?? "http://localhost:3456/api/v1";
const USER = process.env.TEST_USER ?? "mcptester";
const PASS = process.env.TEST_PASS ?? "mcptester-password";
const EMAIL = process.env.TEST_EMAIL ?? "mcptester@example.com";

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, json, text };
}

async function waitForVikunja() {
  process.stdout.write(`Waiting for Vikunja at ${BASE} `);
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/info`);
      if (res.ok) {
        process.stdout.write(" up\n");
        return;
      }
    } catch {
      // not listening yet
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`\nVikunja never became reachable at ${BASE}. Is it running? (docker compose up -d)`);
}

async function ensureUser() {
  const reg = await post("/register", { username: USER, email: EMAIL, password: PASS });
  if (reg.ok) {
    console.log(`Registered test user "${USER}".`);
    return;
  }
  // A user that already exists is fine — we just log in below.
  const already = reg.text.includes("already") || reg.status === 400;
  if (already) {
    console.log(`Test user "${USER}" already exists — reusing it.`);
    return;
  }
  throw new Error(`Registration failed (${reg.status}): ${reg.text.slice(0, 300)}`);
}

async function login() {
  const res = await post("/login", { username: USER, password: PASS });
  if (!res.ok || !res.json?.token) {
    throw new Error(`Login failed (${res.status}): ${res.text.slice(0, 300)}`);
  }
  return res.json.token;
}

async function main() {
  await waitForVikunja();
  await ensureUser();
  const token = await login();

  const env = [
    "# Written by scripts/bootstrap.mjs — local test environment.",
    "# Bearer token is a Vikunja session JWT; regenerate with `npm run bootstrap`.",
    `VIKUNJA_URL=${BASE}`,
    `VIKUNJA_API_TOKEN=${token}`,
    "",
  ].join("\n");
  await writeFile(ENV_PATH, env, "utf8");

  console.log(`\nWrote ${ENV_PATH}`);
  console.log("Run the MCP against it with:  node --env-file=.env index.js");
  console.log("Or run the end-to-end tests:  npm run test:e2e");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

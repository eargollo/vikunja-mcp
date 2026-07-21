#!/usr/bin/env node
// Minimal, self-owned MCP server for Vikunja — the executable shell.
//
// All the logic with a branch to get wrong (config resolution, the tools/list
// and tools/call handlers) lives in server.js, where it is unit-tested in-process.
// This file only guards the runtime, reads the environment, gates tools by tier,
// and connects the stdio transport.
//
// Trust posture (the whole point of this repo):
//   - ONE direct dependency: the official @modelcontextprotocol/sdk. HTTP is
//     Node's built-in fetch — no axios, no client libs of our own. The only
//     transitive deps are the SDK's, and the stdio transport never loads its
//     HTTP/OAuth stack.
//   - Every outbound request goes through makeApi() in api.js, so there is
//     exactly one place that can talk to the network, and it only ever talks to
//     VIKUNJA_URL with your token.
//   - READ + ADDITIVE tools by default. Write and delete tools are opt-in via
//     VIKUNJA_MCP_ALLOW_WRITE / _ALLOW_DELETE — a default install can't modify,
//     share, exfiltrate, or destroy anything.

import pkg from "./package.json" with { type: "json" };
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { makeApi } from "./api.js";
import { requireNodeMinVersion, tierAllowed } from "./lib.js";
import { buildTools } from "./tools.js";
import { resolveConfig, createServer } from "./server.js";

let config;
try {
  requireNodeMinVersion(20);
  config = resolveConfig(process.env);
} catch (err) {
  console.error(`vikunja-mcp: ${err.message}`);
  process.exit(1);
}

const api = makeApi({ base: config.base, token: config.token });
// Tools are defined in tools.js with an injected api(); gate by tier here so a
// default install exposes only read + additive.
const tools = buildTools({ api, base: config.base }).filter((t) => tierAllowed(t.tier, config.gate));

const server = createServer({ tools, version: pkg.version });
await server.connect(new StdioServerTransport());
console.error("vikunja-mcp connected (stdio)");

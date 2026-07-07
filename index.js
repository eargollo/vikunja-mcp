#!/usr/bin/env node
// Minimal, self-owned MCP server for Vikunja.
//
// Trust posture (the whole point of this repo):
//   - ONE dependency: the official @modelcontextprotocol/sdk. HTTP is Node's
//     built-in fetch — no axios, no client libs, no transitive surface.
//   - Every outbound request goes through makeApi() in api.js, so there is
//     exactly one place that can talk to the network, and it only ever talks to
//     VIKUNJA_URL with your token.
//   - READ + ADDITIVE tools by default (list + create). Write (update, access-
//     granting, egress) and delete tools are opt-in via VIKUNJA_MCP_ALLOW_WRITE /
//     _ALLOW_DELETE — a default install can't modify, share, exfiltrate, or
//     destroy anything.
//   - Credentials come from the environment, never hardcoded.

import pkg from "./package.json" with { type: "json" };
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { makeApi } from "./api.js";
import {
  requireAbsoluteUrl,
  flagEnabled,
  tierAllowed,
  tierAnnotations,
  SERVER_INSTRUCTIONS,
  requireNodeMinVersion,
} from "./lib.js";
import { buildTools } from "./tools.js";

try {
  requireNodeMinVersion(20);
} catch (err) {
  console.error(`vikunja-mcp: ${err.message}`);
  process.exit(1);
}

let BASE;
try {
  BASE = requireAbsoluteUrl(process.env.VIKUNJA_URL, "VIKUNJA_URL");
} catch (err) {
  console.error(`vikunja-mcp: ${err.message}`);
  process.exit(1);
}

const TOKEN = process.env.VIKUNJA_API_TOKEN;
if (!TOKEN) {
  console.error("vikunja-mcp: set VIKUNJA_API_TOKEN");
  process.exit(1);
}

const api = makeApi({ base: BASE, token: TOKEN });

// Opt-in gating: read + additive tools are always exposed; write (update) and
// delete (destructive) tools appear only when their env flag is set. A default
// install can read and add — never modify or destroy.
const gate = {
  allowWrite: flagEnabled(process.env.VIKUNJA_MCP_ALLOW_WRITE),
  allowDelete: flagEnabled(process.env.VIKUNJA_MCP_ALLOW_DELETE),
};

// Tools are defined in tools.js with an injected api(); gate by tier here.
const TOOLS = buildTools({ api }).filter((t) => tierAllowed(t.tier, gate));

const server = new Server(
  { name: "vikunja-mcp", version: pkg.version, instructions: SERVER_INSTRUCTIONS },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema, tier }) => ({
    name,
    description,
    inputSchema,
    annotations: tierAnnotations(tier, name),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
    const result = await tool.run(req.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
console.error("vikunja-mcp connected (stdio)");

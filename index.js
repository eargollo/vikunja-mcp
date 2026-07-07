#!/usr/bin/env node
// Minimal, self-owned MCP server for Vikunja.
//
// Trust posture (the whole point of this repo):
//   - ONE dependency: the official @modelcontextprotocol/sdk. HTTP is Node's
//     built-in fetch — no axios, no client libs, no transitive surface.
//   - Every outbound request goes through the single api() function below, so
//     there is exactly one place that can talk to the network, and it only ever
//     talks to VIKUNJA_URL with your token.
//   - READ + ADDITIVE tools by default (list + create). Write (update) and
//     delete tools are opt-in via VIKUNJA_MCP_ALLOW_WRITE / _ALLOW_DELETE, so a
//     default install — or a hijacked agent — can't modify or destroy anything.
//   - Credentials come from the environment, never hardcoded.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { requireAbsoluteUrl, flagEnabled, tierAllowed } from "./lib.js";
import { buildTools } from "./tools.js";

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

// The only network egress in the whole server: fixed base URL, fixed token,
// JSON in/out (plus multipart FormData for file uploads). Nothing else reaches
// out. FormData bodies are passed through untouched so fetch sets the multipart
// Content-Type + boundary itself; everything else is JSON.
async function api(method, path, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(isForm ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const detail = text.slice(0, 400);
    console.error(`vikunja-mcp: ${method} ${path} -> ${res.status}: ${detail}`);
    if (res.status >= 500) {
      throw new Error(`Vikunja ${method} ${path} -> ${res.status}: server error`);
    }
    throw new Error(`Vikunja ${method} ${path} -> ${res.status}: ${detail}`);
  }
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Vikunja ${method} ${path} -> invalid JSON response`);
    }
  }
  return { data, headers: res.headers };
}

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
  { name: "vikunja-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
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

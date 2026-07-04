#!/usr/bin/env node
// Minimal, self-owned MCP server for Vikunja.
//
// Trust posture (the whole point of this repo):
//   - ONE dependency: the official @modelcontextprotocol/sdk. HTTP is Node's
//     built-in fetch — no axios, no client libs, no transitive surface.
//   - Every outbound request goes through the single api() function below, so
//     there is exactly one place that can talk to the network, and it only ever
//     talks to VIKUNJA_URL with your token.
//   - Scoped to READ + ADDITIVE operations only (list + create). No delete, no
//     bulk, no "run arbitrary endpoint" — so a hijacked agent can't do damage.
//   - Credentials come from the environment, never hardcoded.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE = process.env.VIKUNJA_URL; // e.g. http://192.168.100.20:3456/api/v1
const TOKEN = process.env.VIKUNJA_API_TOKEN;

if (!BASE || !TOKEN) {
  console.error("vikunja-mcp: set VIKUNJA_URL and VIKUNJA_API_TOKEN");
  process.exit(1);
}

// The only network egress in the whole server: fixed base URL, fixed token,
// JSON in/out. Nothing else reaches out.
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vikunja ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

// Read + additive only. Add tools here deliberately; nothing is exposed by default.
const TOOLS = [
  {
    name: "list_projects",
    description: "List Vikunja projects the token can see (id + title).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const projects = await api("GET", "/projects");
      return (projects ?? []).map((p) => ({ id: p.id, title: p.title }));
    },
  },
  {
    name: "list_tasks",
    description: "List tasks in a project by project id (id, title, done).",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "number", description: "Vikunja project id" } },
      required: ["project_id"],
      additionalProperties: false,
    },
    run: async ({ project_id }) => {
      const tasks = await api("GET", `/projects/${project_id}/tasks`);
      return (tasks ?? []).map((t) => ({ id: t.id, title: t.title, done: t.done }));
    },
  },
  {
    name: "create_task",
    description: "Create a task with a title in a project (additive only).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "number", description: "Vikunja project id" },
        title: { type: "string", description: "Task title" },
      },
      required: ["project_id", "title"],
      additionalProperties: false,
    },
    run: async ({ project_id, title }) => {
      const task = await api("PUT", `/projects/${project_id}/tasks`, { title });
      return { id: task.id, title: task.title };
    },
  },
];

const server = new Server(
  { name: "vikunja-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
  try {
    const result = await tool.run(req.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
console.error("vikunja-mcp connected (stdio)");

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

function requireAbsoluteUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL (e.g. http://host:3456/api/v1)`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString().replace(/\/+$/, "");
}

function requireProjectId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("project_id must be a positive integer");
  }
  return id;
}

function requireTitle(value) {
  if (typeof value !== "string") {
    throw new Error("title must be a string");
  }
  const title = value.trim();
  if (!title) {
    throw new Error("title must not be empty");
  }
  return title;
}

function optionalPage(value, name = "page") {
  if (value === undefined) return undefined;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return page;
}

function optionalPerPage(value) {
  if (value === undefined) return undefined;
  const perPage = Number(value);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
    throw new Error("per_page must be an integer between 1 and 100");
  }
  return perPage;
}

function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined) search.set(key, String(val));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

const paginationSchema = {
  page: { type: "number", description: "Page number (default: 1)" },
  per_page: {
    type: "number",
    description: "Items per page, 1-100 (Vikunja default if omitted)",
  },
};

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
    const detail = text.slice(0, 400);
    console.error(`vikunja-mcp: ${method} ${path} -> ${res.status}: ${detail}`);
    if (res.status >= 500) {
      throw new Error(`Vikunja ${method} ${path} -> ${res.status}: server error`);
    }
    throw new Error(`Vikunja ${method} ${path} -> ${res.status}: ${detail}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Vikunja ${method} ${path} -> invalid JSON response`);
  }
}

function paginatedResult(items, page, perPage) {
  return {
    page: page ?? 1,
    ...(perPage !== undefined ? { per_page: perPage } : {}),
    count: items.length,
    items,
  };
}

// Read + additive only. Add tools here deliberately; nothing is exposed by default.
const TOOLS = [
  {
    name: "list_projects",
    description:
      "List Vikunja projects the token can see (id + title). Results are paginated; pass page/per_page or iterate pages until count is less than per_page.",
    inputSchema: {
      type: "object",
      properties: paginationSchema,
      additionalProperties: false,
    },
    run: async ({ page, per_page } = {}) => {
      const resolvedPage = optionalPage(page);
      const resolvedPerPage = optionalPerPage(per_page);
      const query = buildQuery({
        page: resolvedPage,
        per_page: resolvedPerPage,
      });
      const projects = await api("GET", `/projects${query}`);
      const items = (projects ?? []).map((p) => ({ id: p.id, title: p.title }));
      return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage);
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks in a project by project id (id, title, done). Results are paginated; pass page/per_page or iterate pages until count is less than per_page.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "number", description: "Vikunja project id" },
        ...paginationSchema,
      },
      required: ["project_id"],
      additionalProperties: false,
    },
    run: async ({ project_id, page, per_page }) => {
      const id = requireProjectId(project_id);
      const resolvedPage = optionalPage(page);
      const resolvedPerPage = optionalPerPage(per_page);
      const query = buildQuery({
        page: resolvedPage,
        per_page: resolvedPerPage,
      });
      const tasks = await api("GET", `/projects/${id}/tasks${query}`);
      const items = (tasks ?? []).map((t) => ({ id: t.id, title: t.title, done: t.done }));
      return paginatedResult(items, resolvedPage ?? 1, resolvedPerPage);
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
      const id = requireProjectId(project_id);
      const taskTitle = requireTitle(title);
      const task = await api("PUT", `/projects/${id}/tasks`, { title: taskTitle });
      if (!task || task.id == null) {
        throw new Error("Vikunja returned an empty task response");
      }
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

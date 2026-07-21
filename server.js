// Server assembly for vikunja-mcp, split out of index.js so the config
// resolution and the request-handler logic can be unit-tested in-process. index.js
// stays a thin executable shell (guard runtime -> resolve config -> connect
// stdio) that can only be exercised as a subprocess; everything with a branch to
// get wrong lives here, behind plain function calls.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  requireAbsoluteUrl,
  flagEnabled,
  tierAnnotations,
  toolDisplayTitle,
  SERVER_INSTRUCTIONS,
} from "./lib.js";

// Validate the environment into a config object, or throw with the message
// index.js prints before it exits. Credentials come from the environment, never
// hardcoded. Keeps all env parsing in one testable place.
export function resolveConfig(env) {
  const base = requireAbsoluteUrl(env.VIKUNJA_URL, "VIKUNJA_URL");
  if (!env.VIKUNJA_API_TOKEN) {
    throw new Error("set VIKUNJA_API_TOKEN");
  }
  // Opt-in gating: read + additive tools are always exposed; write (update) and
  // delete (destructive) tools appear only when their env flag is set. A default
  // install can read and add — never modify or destroy.
  return {
    base,
    token: env.VIKUNJA_API_TOKEN,
    gate: {
      allowWrite: flagEnabled(env.VIKUNJA_MCP_ALLOW_WRITE),
      allowDelete: flagEnabled(env.VIKUNJA_MCP_ALLOW_DELETE),
    },
  };
}

// Shape the tool list into the tools/list response: a display title plus
// tier-derived annotations so hosts can auto-approve reads and confirm true
// deletes.
export function listToolsResult(tools) {
  return {
    tools: tools.map(({ name, description, inputSchema, tier }) => ({
      name,
      title: toolDisplayTitle(name),
      description,
      inputSchema,
      annotations: tierAnnotations(tier, name),
    })),
  };
}

// Dispatch a tools/call request: run the named tool and expose its JSON result
// as both a text block (back-compat) and structuredContent for typed clients.
// Any throw — unknown tool, validation, network — becomes an isError result
// rather than crashing the server.
export async function runTool(tools, params) {
  try {
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) throw new Error(`Unknown tool: ${params.name}`);
    const result = await tool.run(params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
}

// Build the MCP Server with both request handlers wired to the given tool list.
export function createServer({ tools, version }) {
  const server = new Server(
    { name: "vikunja-mcp", version, instructions: SERVER_INSTRUCTIONS },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => listToolsResult(tools));
  server.setRequestHandler(CallToolRequestSchema, async (req) => runTool(tools, req.params));
  return server;
}

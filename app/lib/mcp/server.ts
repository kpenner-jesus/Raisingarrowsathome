// ============================================================
//  MCP JSON-RPC server (Streamable HTTP, stateless POST)
//
//  Spec: https://modelcontextprotocol.io/specification
//  + JSON-RPC 2.0: https://www.jsonrpc.org/specification
//
//  Supports:
//    - initialize
//    - notifications/* (no response, per spec)
//    - tools/list
//    - tools/call
//    - ping
//    - JSON-RPC batch (array body) with notification filtering
// ============================================================

import { TOOLS, type ToolContext } from "./tools";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name:    "raising-arrows-portal",
  version: "1.0.0",
};

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?:     string | number | null;
  method:  string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id:      string | number | null;
  result?: any;
  error?:  { code: number; message: string; data?: any };
}

/** A JSON-RPC notification is a request with no `id` property at all. */
function isNotification(req: JsonRpcRequest): boolean {
  return !("id" in req) || req.id === undefined;
}

function ok(id: any, result: any): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function err(id: any, code: number, message: string, data?: any): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

/** Handle a single JSON-RPC request. Returns null for notifications. */
export async function handleRpc(req: JsonRpcRequest, ctx: ToolContext): Promise<JsonRpcResponse | null> {
  // Notifications: process side-effects but never reply.
  const notification = isNotification(req);

  try {
    // Reject obviously-invalid envelopes
    if (!req || typeof req !== "object" || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      if (notification) return null;
      return err(req?.id, -32600, "invalid request");
    }

    switch (req.method) {
      case "initialize":
        if (notification) return null;
        return ok(req.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities:    { tools: {} },
          serverInfo:      SERVER_INFO,
        });

      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/progress":
        // Spec: notifications get NO response, even if id accidentally provided.
        return null;

      case "tools/list":
        if (notification) return null;
        return ok(req.id, {
          tools: TOOLS.map((t) => ({
            name:        t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case "tools/call": {
        if (notification) return null;
        const name = req.params?.name;
        const args = req.params?.arguments || {};
        if (typeof name !== "string") return err(req.id, -32602, "invalid params: missing tool name");
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) {
          // Surface unknown-tool via content channel so LLMs can self-correct.
          return ok(req.id, {
            isError: true,
            content: [{ type: "text", text: `unknown tool: ${name}` }],
          });
        }
        try {
          const result = await tool.handler(args, ctx);
          return ok(req.id, {
            content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
          });
        } catch (e: any) {
          return ok(req.id, {
            isError: true,
            content: [{ type: "text", text: e?.message || String(e) }],
          });
        }
      }

      case "ping":
        if (notification) return null;
        return ok(req.id, {});

      default:
        if (notification) return null;
        return err(req.id, -32601, `method not found: ${req.method}`);
    }
  } catch (e: any) {
    if (notification) return null;
    return err(req.id, -32603, "internal error", { message: e?.message });
  }
}

/** Handle a JSON-RPC batch (array). Returns response array, with notifications filtered. */
export async function handleRpcBatch(reqs: JsonRpcRequest[], ctx: ToolContext): Promise<JsonRpcResponse[] | null> {
  if (!Array.isArray(reqs)) {
    return [err(null, -32600, "batch must be a non-empty array")];
  }
  if (reqs.length === 0) {
    // Per spec, empty batch is an Invalid Request.
    return [err(null, -32600, "empty batch")];
  }
  const responses: JsonRpcResponse[] = [];
  for (const r of reqs) {
    const resp = await handleRpc(r, ctx);
    if (resp !== null) responses.push(resp);
  }
  // If every request was a notification, return nothing per spec.
  return responses.length === 0 ? null : responses;
}

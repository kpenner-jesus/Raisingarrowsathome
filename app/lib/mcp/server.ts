// ============================================================
//  MCP JSON-RPC server (Streamable HTTP, stateless POST)
//
//  Spec: https://modelcontextprotocol.io/specification
//  Supports:
//    - initialize
//    - tools/list
//    - tools/call
//  Skipped (not needed for stateless CRUD):
//    - SSE notifications
//    - sampling, prompts, resources
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

function ok(id: any, result: any): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function err(id: any, code: number, message: string, data?: any): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

export async function handleRpc(req: JsonRpcRequest, ctx: ToolContext): Promise<JsonRpcResponse> {
  try {
    switch (req.method) {
      case "initialize":
        return ok(req.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities:    { tools: {} },
          serverInfo:      SERVER_INFO,
        });

      case "notifications/initialized":
        // Notification — no response required, but if id present, ack.
        return ok(req.id, {});

      case "tools/list":
        return ok(req.id, {
          tools: TOOLS.map((t) => ({
            name:        t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case "tools/call": {
        const name = req.params?.name;
        const args = req.params?.arguments || {};
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return err(req.id, -32602, `unknown tool: ${name}`);
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
        return ok(req.id, {});

      default:
        return err(req.id, -32601, `method not found: ${req.method}`);
    }
  } catch (e: any) {
    return err(req.id, -32603, "internal error", { message: e?.message });
  }
}

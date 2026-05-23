// ============================================================
//  POST /api/mcp   — MCP Streamable HTTP endpoint
//
//  Auth: Authorization: Bearer ramcp_<48 hex>
//  Body: single JSON-RPC 2.0 request (or batch — array)
//  Response: JSON-RPC response object (or array for batch)
//
//  Connect with: claude mcp add ... --transport http \
//                  --header "Authorization: Bearer ramcp_xxx" \
//                  https://YOUR-DOMAIN/api/mcp
// ============================================================

import { NextResponse } from "next/server";
import { authBearer } from "@/app/lib/mcp/auth";
import { handleRpc } from "@/app/lib/mcp/server";
import type { ToolContext } from "@/app/lib/mcp/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const token = await authBearer(req.headers.get("authorization"));
  if (!token) {
    return new NextResponse(JSON.stringify({
      jsonrpc: "2.0",
      id:      null,
      error:   { code: -32001, message: "unauthorized" },
    }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const origin = new URL(req.url).origin;
  const ctx: ToolContext = { profile_id: token.profile_id, origin };

  let body: any;
  try { body = await req.json(); }
  catch { return new NextResponse(JSON.stringify({
    jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" },
  }), { status: 400, headers: { "Content-Type": "application/json" } }); }

  // Support JSON-RPC batch (array) and single (object)
  const isBatch = Array.isArray(body);
  const requests = isBatch ? body : [body];
  const responses = await Promise.all(requests.map((r: any) => handleRpc(r, ctx)));
  return NextResponse.json(isBatch ? responses : responses[0]);
}

// MCP clients sometimes probe with GET — answer with server-info.
export async function GET() {
  return NextResponse.json({
    name:    "raising-arrows-portal",
    version: "1.0.0",
    transport: "http",
    docs:    "Send JSON-RPC 2.0 POST requests with Authorization: Bearer ramcp_<token>",
  });
}

// ============================================================
//  POST /api/mcp   — MCP Streamable HTTP endpoint
//
//  Auth: Authorization: Bearer ramcp_<48 hex>
//  Body: single JSON-RPC 2.0 request OR a batch (array)
//  Response: JSON-RPC response, an array for batches, or 204 No
//           Content if every request was a notification.
//
//  Connect with: claude mcp add ... --transport http \
//                  --header "Authorization: Bearer ramcp_xxx" \
//                  https://YOUR-DOMAIN/api/mcp
// ============================================================

import { NextResponse } from "next/server";
import { authBearer } from "@/app/lib/mcp/auth";
import { handleRpc, handleRpcBatch } from "@/app/lib/mcp/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { isTenantAccessBlocked } from "@/app/lib/tenant-access";
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

  // Resolve the tenant slug + status from the token's org_id. Slug is used to
  // build correct portal URLs; status gates access so a paused/canceled tenant's
  // token can't keep reading/writing via MCP (parity with requireAdmin's 423).
  const svc = supabaseService();
  const { data: tenant } = await svc.from("tenants").select("slug, status").eq("id", token.org_id).maybeSingle();
  if (isTenantAccessBlocked(tenant?.status)) {
    return new NextResponse(JSON.stringify({
      jsonrpc: "2.0",
      id:      null,
      error:   { code: -32002, message: `tenant is ${tenant?.status ?? "unknown"} — access paused` },
    }), { status: 423, headers: { "Content-Type": "application/json" } });
  }
  const ctx: ToolContext = {
    profile_id: token.profile_id,
    origin,
    org_id:     token.org_id,
    slug:       tenant?.slug,
  };

  let body: any;
  try { body = await req.json(); }
  catch { return new NextResponse(JSON.stringify({
    jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" },
  }), { status: 400, headers: { "Content-Type": "application/json" } }); }

  const isBatch = Array.isArray(body);

  if (isBatch) {
    const responses = await handleRpcBatch(body, ctx);
    if (responses === null) {
      // All notifications — no response body
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json(responses);
  }

  const response = await handleRpc(body, ctx);
  if (response === null) {
    // Single notification — no response body
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(response);
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

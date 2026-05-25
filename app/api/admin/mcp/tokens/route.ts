// GET  /api/admin/mcp/tokens — list MCP tokens for the signed-in admin
//                              within the current tenant
// POST /api/admin/mcp/tokens — mint a new token (tenant-scoped). Plaintext returned ONCE.
import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { supabaseService } from "@/app/lib/supabase/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

async function authOrError() {
  try { return await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return { error: new NextResponse(e.message, { status: e.status }) };
    throw e;
  }
}

export async function GET() {
  const c = await authOrError();
  if ("error" in c) return c.error;
  const { user, ctx: orgCtx } = c;

  const service = supabaseService();
  // List only tokens the user owns AND that belong to the current tenant.
  // Without the org filter, an admin moving between two tenants they belong
  // to would see/manage the other tenant's tokens.
  const { data } = await service
    .from("api_tokens")
    .select("id, label, prefix, created_at, last_used_at, revoked_at, expires_at")
    .eq("profile_id", user.id)
    .eq("org_id", orgCtx.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ tokens: data || [] });
}

export async function POST(req: Request) {
  const c = await authOrError();
  if ("error" in c) return c.error;
  const { user, ctx: orgCtx } = c;

  const { label } = await req.json().catch(() => ({} as any));
  if (typeof label !== "string" || !label.trim() || label.length > 60) {
    return new NextResponse("label required (≤60 chars)", { status: 400 });
  }

  // Generate token: ramcp_<48 hex>
  const plaintext = "ramcp_" + randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(plaintext).digest("hex");
  const prefix    = plaintext.slice(0, 14);

  const service = supabaseService();
  const { data, error } = await service
    .from("api_tokens")
    .insert({
      org_id:     orgCtx.id,
      profile_id: user.id,
      label:      label.trim(),
      prefix,
      token_hash: tokenHash,
    })
    .select("id, label, prefix, created_at")
    .single();
  if (error) return new NextResponse(error.message, { status: 500 });

  await service.from("audit_log").insert({
    org_id:       orgCtx.id,
    actor_id:     user.id,
    action:       "mcp.mint_token",
    target_table: "api_tokens",
    target_id:    data.id,
    details:      { label: data.label, prefix: data.prefix },
  });

  // Return plaintext ONCE.
  return NextResponse.json({ ...data, token: plaintext });
}

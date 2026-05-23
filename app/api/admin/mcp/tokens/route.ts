// GET  /api/admin/mcp/tokens — list MCP tokens for the signed-in admin
// POST /api/admin/mcp/tokens — mint a new token. Plaintext returned ONCE.
import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

async function requireAdmin(): Promise<{ user: any } | { error: NextResponse }> {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: new NextResponse("unauthorized", { status: 401 }) };
  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return { error: new NextResponse("forbidden", { status: 403 }) };
  }
  return { user };
}

export async function GET() {
  const check = await requireAdmin();
  if ("error" in check) return check.error;

  const service = supabaseService();
  const { data } = await service
    .from("api_tokens")
    .select("id, label, prefix, created_at, last_used_at, revoked_at, expires_at")
    .eq("profile_id", check.user.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ tokens: data || [] });
}

export async function POST(req: Request) {
  const check = await requireAdmin();
  if ("error" in check) return check.error;

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
      profile_id: check.user.id,
      label:      label.trim(),
      prefix,
      token_hash: tokenHash,
    })
    .select("id, label, prefix, created_at")
    .single();
  if (error) return new NextResponse(error.message, { status: 500 });

  await service.from("audit_log").insert({
    actor_id:     check.user.id,
    action:       "mcp.mint_token",
    target_table: "api_tokens",
    target_id:    data.id,
    details:      { label: data.label, prefix: data.prefix },
  });

  // Return plaintext ONCE.
  return NextResponse.json({ ...data, token: plaintext });
}

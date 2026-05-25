// DELETE /api/admin/mcp/tokens/[id] — revoke a token (sets revoked_at).
// Admins can only revoke their OWN tokens in the current org.
// Owner of the org can revoke any token in that org.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return new NextResponse(e.message, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;

  const service = supabaseService();

  // Look up the token scoped to the current tenant so a token id from
  // another org can't be revoked here.
  const { data: token, error: loadErr } = await service
    .from("api_tokens").select("id, profile_id, label, prefix, revoked_at")
    .eq("id", params.id).eq("org_id", orgCtx.id).single();
  if (loadErr || !token) return new NextResponse("token not found", { status: 404 });
  if (token.revoked_at)  return new NextResponse("token already revoked", { status: 409 });

  // Owner-of-org override; otherwise must own the token.
  const { data: membership } = await service.from("org_members")
    .select("role").eq("org_id", orgCtx.id).eq("user_id", user.id).maybeSingle();
  const isOrgOwner = membership?.role === "owner";
  if (!isOrgOwner && token.profile_id !== user.id) {
    return new NextResponse("can only revoke your own tokens", { status: 403 });
  }

  const { error } = await service.from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", params.id).eq("org_id", orgCtx.id);
  if (error) return new NextResponse(error.message, { status: 500 });

  await service.from("audit_log").insert({
    org_id:       orgCtx.id,
    actor_id:     user.id,
    action:       "mcp.revoke_token",
    target_table: "api_tokens",
    target_id:    params.id,
    details:      { label: token.label, prefix: token.prefix },
  });

  return NextResponse.json({ ok: true });
}

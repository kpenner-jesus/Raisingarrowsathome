// DELETE /api/admin/mcp/tokens/[id] — revoke a token (sets revoked_at).
// Admins can only revoke their OWN tokens. Super_admin can revoke any.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return new NextResponse("forbidden", { status: 403 });
  }

  const service = supabaseService();
  const { data: token, error: loadErr } = await service
    .from("api_tokens").select("id, profile_id, label, prefix, revoked_at").eq("id", params.id).single();
  if (loadErr || !token) return new NextResponse("token not found", { status: 404 });
  if (token.revoked_at)  return new NextResponse("token already revoked", { status: 409 });

  if (profile.role !== "super_admin" && token.profile_id !== user.id) {
    return new NextResponse("can only revoke your own tokens", { status: 403 });
  }

  const { error } = await service.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", params.id);
  if (error) return new NextResponse(error.message, { status: 500 });

  await service.from("audit_log").insert({
    actor_id:     user.id,
    action:       "mcp.revoke_token",
    target_table: "api_tokens",
    target_id:    params.id,
    details:      { label: token.label, prefix: token.prefix },
  });

  return NextResponse.json({ ok: true });
}

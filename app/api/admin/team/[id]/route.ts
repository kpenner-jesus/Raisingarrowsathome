// PATCH  /api/admin/team/[id] — change a team member's per-tenant role
// DELETE /api/admin/team/[id] — remove them from the current tenant
//
// Safety: never allow the LAST owner of the tenant to be demoted/removed.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { getOrgContext } from "@/app/lib/org-context";

async function requireOrgOwner(): Promise<{ user: any; orgId: string } | { error: NextResponse }> {
  const orgCtx = await getOrgContext();
  if (!orgCtx) return { error: NextResponse.json({ error: "no tenant resolved" }, { status: 400 }) };

  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: new NextResponse("unauthorized", { status: 401 }) };

  const svc = supabaseService();
  const { data: membership } = await svc.from("org_members")
    .select("role").eq("org_id", orgCtx.id).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") {
    return { error: new NextResponse("forbidden — owner only", { status: 403 }) };
  }
  return { user, orgId: orgCtx.id };
}

async function countOwners(service: ReturnType<typeof supabaseService>, orgId: string): Promise<number> {
  const { count } = await service.from("org_members")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId).eq("role", "owner");
  return count ?? 0;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const check = await requireOrgOwner();
  if ("error" in check) return check.error;

  const { role } = await req.json().catch(() => ({} as any));
  if (!["admin", "owner"].includes(role)) {
    return new NextResponse("invalid role (admin or owner)", { status: 400 });
  }

  const service = supabaseService();
  const { data: target } = await service.from("org_members")
    .select("user_id, role, profiles:user_id(email)")
    .eq("org_id", check.orgId).eq("user_id", params.id).maybeSingle();
  if (!target) return new NextResponse("user not in this org", { status: 404 });

  // Lockout guard: can't demote the last owner of the org.
  if (target.role === "owner" && role !== "owner") {
    const n = await countOwners(service, check.orgId);
    if (n <= 1) {
      return new NextResponse("cannot demote the last owner — promote someone else first", { status: 409 });
    }
  }

  const { error } = await service.from("org_members")
    .update({ role })
    .eq("org_id", check.orgId).eq("user_id", params.id);
  if (error) return new NextResponse(error.message, { status: 500 });

  await service.from("audit_log").insert({
    org_id:       check.orgId,
    actor_id:     check.user.id,
    action:       "team.role_change",
    target_table: "org_members",
    target_id:    params.id,
    details:      { email: (target as any).profiles?.email ?? null, from: target.role, to: role },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const check = await requireOrgOwner();
  if ("error" in check) return check.error;

  const service = supabaseService();
  const { data: target } = await service.from("org_members")
    .select("user_id, role, profiles:user_id(email)")
    .eq("org_id", check.orgId).eq("user_id", params.id).maybeSingle();
  if (!target) return new NextResponse("user not in this org", { status: 404 });

  if (target.role === "owner") {
    const n = await countOwners(service, check.orgId);
    if (n <= 1) {
      return new NextResponse("cannot revoke the last owner", { status: 409 });
    }
  }

  const { error } = await service.from("org_members")
    .delete()
    .eq("org_id", check.orgId).eq("user_id", params.id);
  if (error) return new NextResponse(error.message, { status: 500 });

  await service.from("audit_log").insert({
    org_id:       check.orgId,
    actor_id:     check.user.id,
    action:       "team.revoke",
    target_table: "org_members",
    target_id:    params.id,
    details:      { email: (target as any).profiles?.email ?? null, was: target.role },
  });

  return NextResponse.json({ ok: true });
}

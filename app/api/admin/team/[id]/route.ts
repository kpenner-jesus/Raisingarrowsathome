// PATCH  /api/admin/team/[id] — change a team member's role
// DELETE /api/admin/team/[id] — demote to 'recipient' (effectively revoke admin)
//
// Safety: never allow the LAST super_admin to be demoted (avoid lockout).
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

async function requireSuperAdmin(): Promise<{ user: any } | { error: NextResponse }> {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: new NextResponse("unauthorized", { status: 401 }) };
  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return { error: new NextResponse("forbidden — super_admin only", { status: 403 }) };
  return { user };
}

async function countSuperAdmins(service: ReturnType<typeof supabaseService>): Promise<number> {
  const { count } = await service.from("profiles").select("*", { count: "exact", head: true }).eq("role", "super_admin");
  return count ?? 0;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const check = await requireSuperAdmin();
  if ("error" in check) return check.error;

  const { role } = await req.json().catch(() => ({} as any));
  if (!["recipient", "admin", "super_admin"].includes(role)) {
    return new NextResponse("invalid role", { status: 400 });
  }

  const service = supabaseService();
  const { data: target, error: loadErr } = await service
    .from("profiles").select("id, email, role").eq("id", params.id).single();
  if (loadErr || !target) return new NextResponse("user not found", { status: 404 });

  // Lockout guard: can't demote the last super_admin
  if (target.role === "super_admin" && role !== "super_admin") {
    const n = await countSuperAdmins(service);
    if (n <= 1) {
      return new NextResponse("cannot demote the last super_admin — promote someone else first", { status: 409 });
    }
  }

  const { error } = await service.from("profiles").update({ role }).eq("id", params.id);
  if (error) return new NextResponse(error.message, { status: 500 });

  await service.from("audit_log").insert({
    actor_id:     check.user.id,
    action:       "team.role_change",
    target_table: "profiles",
    target_id:    params.id,
    details:      { email: target.email, from: target.role, to: role },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const check = await requireSuperAdmin();
  if ("error" in check) return check.error;

  const service = supabaseService();
  const { data: target, error: loadErr } = await service
    .from("profiles").select("id, email, role").eq("id", params.id).single();
  if (loadErr || !target) return new NextResponse("user not found", { status: 404 });

  if (target.role === "super_admin") {
    const n = await countSuperAdmins(service);
    if (n <= 1) {
      return new NextResponse("cannot revoke the last super_admin", { status: 409 });
    }
  }

  const { error } = await service.from("profiles").update({ role: "recipient" }).eq("id", params.id);
  if (error) return new NextResponse(error.message, { status: 500 });

  await service.from("audit_log").insert({
    actor_id:     check.user.id,
    action:       "team.revoke",
    target_table: "profiles",
    target_id:    params.id,
    details:      { email: target.email, was: target.role },
  });

  return NextResponse.json({ ok: true });
}

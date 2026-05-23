// GET  /api/admin/team — list all admins / super_admins
// POST /api/admin/team — invite a new admin (super_admin only)
//
// Auth: super_admin only.
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

export async function GET() {
  const check = await requireSuperAdmin();
  if ("error" in check) return check.error;

  const service = supabaseService();
  const { data, error } = await service
    .from("profiles")
    .select("id, email, role, created_at")
    .in("role", ["admin", "super_admin"])
    .order("role", { ascending: false })
    .order("email", { ascending: true });
  if (error) return new NextResponse(error.message, { status: 500 });

  // Sign-in times
  const { data: list } = await service.auth.admin.listUsers();
  const lastSignIn: Record<string, string | null> = {};
  list?.users.forEach((u) => { lastSignIn[u.id] = u.last_sign_in_at ?? null; });

  return NextResponse.json({
    team: (data || []).map((p: any) => ({ ...p, last_sign_in_at: lastSignIn[p.id] ?? null })),
  });
}

export async function POST(req: Request) {
  const check = await requireSuperAdmin();
  if ("error" in check) return check.error;

  const { email, role } = await req.json().catch(() => ({} as any));
  if (typeof email !== "string" || !email.includes("@")) {
    return new NextResponse("invalid email", { status: 400 });
  }
  if (!["admin", "super_admin"].includes(role)) {
    return new NextResponse("role must be admin or super_admin", { status: 400 });
  }

  const service = supabaseService();

  // Create the auth user (silently skip if already exists).
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email, email_confirm: true,
  });
  let userId = created?.user?.id ?? null;
  if (createErr && !/already.*registered|already exists/i.test(createErr.message)) {
    return new NextResponse(`auth user create failed: ${createErr.message}`, { status: 500 });
  }
  if (!userId) {
    const { data: existing } = await service.auth.admin.listUsers();
    userId = existing?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
  }
  if (!userId) return new NextResponse("could not resolve user id", { status: 500 });

  // Upsert profile with desired role
  const { error: profErr } = await service.from("profiles").upsert(
    { id: userId, email, role },
    { onConflict: "id" }
  );
  if (profErr) return new NextResponse(profErr.message, { status: 500 });

  // Audit
  await service.from("audit_log").insert({
    actor_id:     check.user.id,
    action:       "team.invite",
    target_table: "profiles",
    target_id:    userId,
    details:      { email, role },
  });

  return NextResponse.json({ ok: true, id: userId, email, role });
}

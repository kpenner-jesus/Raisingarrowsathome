// GET  /api/admin/team — list team members (owner/admin) for the current tenant
// POST /api/admin/team — invite a new admin/owner to the current tenant
//
// Auth: owner of the current org.
//
// Note: in the multi-tenant model, "team" = the rows in org_members for the
// current tenant joined to profiles for display info. The legacy `profiles.role`
// column is platform-level only (super_admin = platform staff) and is no longer
// used for tenant-level admin gating.
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

export async function GET() {
  const check = await requireOrgOwner();
  if ("error" in check) return check.error;

  const service = supabaseService();
  // Members of this tenant. Joining profiles for email/created_at so the UI
  // can render a single rows list per the prior shape (id, email, role,
  // created_at, last_sign_in_at).
  const { data, error } = await service
    .from("org_members")
    .select("user_id, role, created_at, profiles:user_id(email, created_at)")
    .eq("org_id", check.orgId)
    .in("role", ["owner", "admin"])
    .order("role", { ascending: false });
  if (error) return new NextResponse(error.message, { status: 500 });

  // Sign-in times (platform-wide listUsers; safe — we only emit ids we already
  // know are members of this tenant).
  const { data: list } = await service.auth.admin.listUsers();
  const lastSignIn: Record<string, string | null> = {};
  list?.users.forEach((u) => { lastSignIn[u.id] = u.last_sign_in_at ?? null; });

  return NextResponse.json({
    team: (data || []).map((p: any) => ({
      id:               p.user_id,
      email:            p.profiles?.email ?? null,
      role:             p.role,
      created_at:       p.created_at,
      last_sign_in_at:  lastSignIn[p.user_id] ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const check = await requireOrgOwner();
  if ("error" in check) return check.error;

  const { email, role } = await req.json().catch(() => ({} as any));
  if (typeof email !== "string" || !email.includes("@")) {
    return new NextResponse("invalid email", { status: 400 });
  }
  if (!["admin", "owner"].includes(role)) {
    return new NextResponse("role must be admin or owner", { status: 400 });
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

  // Upsert profile (platform-wide row, role stays whatever it was; no longer
  // used for tenant gating).
  const { error: profErr } = await service.from("profiles").upsert(
    { id: userId, email },
    { onConflict: "id" }
  );
  if (profErr) return new NextResponse(profErr.message, { status: 500 });

  // Add (or update) their per-tenant role in org_members.
  const { error: memErr } = await service.from("org_members").upsert(
    { org_id: check.orgId, user_id: userId, role, invited_by: check.user.id },
    { onConflict: "org_id,user_id" }
  );
  if (memErr) return new NextResponse(memErr.message, { status: 500 });

  // Audit (org-scoped)
  await service.from("audit_log").insert({
    org_id:       check.orgId,
    actor_id:     check.user.id,
    action:       "team.invite",
    target_table: "org_members",
    target_id:    userId,
    details:      { email, role },
  });

  return NextResponse.json({ ok: true, id: userId, email, role });
}

// POST /api/admin/applications/bulk-deny
// body: { ids: string[], notes: string }
// Marks each pending application as denied with the same admin_notes.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";

export async function POST(req: Request) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : [];
  const notes: string = typeof body?.notes === "string" ? body.notes.trim() : "";
  if (ids.length === 0) return NextResponse.json({ error: "no ids" }, { status: 400 });
  if (ids.length > 100) return NextResponse.json({ error: "max 100 per call" }, { status: 400 });
  if (!notes)           return NextResponse.json({ error: "notes required (will be emailed to the family)" }, { status: 400 });

  const svc = supabaseService();
  const now = new Date().toISOString();

  const { data: updated, error } = await svc.from("applications")
    .update({ status: "denied", admin_notes: notes, decided_at: now, decided_by: user.id })
    .in("id", ids).eq("status", "pending")
    .select("id, parent_names, contact_email");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const u of updated ?? []) {
    await writeAudit({
      actorId:     user.id,
      action:      "decide_application",
      targetTable: "applications",
      targetId:    u.id,
      details:     { decision: "denied", notes, bulk: true },
    });
  }

  return NextResponse.json({ ok: true, denied_count: updated?.length ?? 0, denied_ids: (updated ?? []).map((u: any) => u.id) });
}

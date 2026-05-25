// POST /api/admin/applications/bulk-deny
// body: { ids: string[], notes: string }
// Marks each pending application as denied with the same admin_notes.
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { notifyApplicationDenied } from "@/app/lib/notify";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

export async function POST(req: Request) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;

  const body = await req.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string") : [];
  const notes: string = typeof body?.notes === "string" ? body.notes.trim() : "";
  if (ids.length === 0) return NextResponse.json({ error: "no ids" }, { status: 400 });
  if (ids.length > 100) return NextResponse.json({ error: "max 100 per call" }, { status: 400 });
  if (!notes)           return NextResponse.json({ error: "notes required (will be emailed to the family)" }, { status: 400 });

  const svc = supabaseService();
  const now = new Date().toISOString();

  // Scope the update to this org so an admin can never accidentally deny
  // applications belonging to a different tenant by id collision/spoofing.
  const { data: updated, error } = await svc.from("applications")
    .update({ status: "denied", admin_notes: notes, decided_at: now, decided_by: user.id })
    .in("id", ids).eq("org_id", orgCtx.id).eq("status", "pending")
    .select("id, parent_names, contact_email");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  for (const u of updated ?? []) {
    await writeAudit({
      orgId:       orgCtx.id,
      actorId:     user.id,
      action:      "decide_application",
      targetTable: "applications",
      targetId:    u.id,
      details:     { decision: "denied", notes, bulk: true },
    });
  }

  // Send rejection emails. Each send is fire-and-forget inside notify
  // (errors logged, not raised) so a flaky inbox can't break the batch.
  let emailed = 0, failed = 0;
  await Promise.all((updated ?? []).map(async (u: any) => {
    if (!u.contact_email) { failed++; return; }
    try {
      await notifyApplicationDenied({
        to:           u.contact_email,
        parent_names: u.parent_names,
        admin_notes:  notes,
        orgId:        orgCtx.id,
      });
      emailed++;
    } catch {
      failed++;
    }
  }));

  return NextResponse.json({
    ok: true,
    denied_count: updated?.length ?? 0,
    denied_ids:   (updated ?? []).map((u: any) => u.id),
    emailed,
    failed,
  });
}

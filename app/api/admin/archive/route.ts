// POST /api/admin/archive   { table: 'recipients'|'applications', id, reason }
// POST /api/admin/archive/restore  { table, id }
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

const VALID_TABLES = new Set(["recipients", "applications"]);

export async function POST(req: Request) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { user, ctx: orgCtx } = auth;
  const svc = supabaseService();

  const body = await req.json().catch(() => ({} as any));
  const table  = typeof body?.table === "string" ? body.table : "";
  const id     = typeof body?.id === "string"    ? body.id    : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const restore = body?.restore === true;
  if (!VALID_TABLES.has(table)) return NextResponse.json({ error: "table invalid" }, { status: 400 });
  if (!id)                      return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!restore && !reason)      return NextResponse.json({ error: "reason required to archive" }, { status: 400 });
  if (reason.length > 500)      return NextResponse.json({ error: "reason too long" }, { status: 400 });

  const updates: Record<string, any> = restore
    ? { archived_at: null, archived_by: null, archive_reason: null }
    : { archived_at: new Date().toISOString(), archived_by: user.id, archive_reason: reason };

  // Tenant scope: only mutate rows belonging to the caller's org.
  const { error } = await svc.from(table).update(updates).eq("id", id).eq("org_id", orgCtx.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id,
    action: restore ? "restore_record" : "archive_record",
    targetTable: table,
    targetId: id,
    details: restore ? {} : { reason },
  });
  return NextResponse.json({ ok: true });
}

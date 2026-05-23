// POST /api/admin/archive   { table: 'recipients'|'applications', id, reason }
// POST /api/admin/archive/restore  { table, id }
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";

const VALID_TABLES = new Set(["recipients", "applications"]);

async function adminCtx() {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { user, svc };
}

export async function POST(req: Request) {
  const c = await adminCtx();
  if ("error" in c) return c.error;

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
    : { archived_at: new Date().toISOString(), archived_by: c.user.id, archive_reason: reason };

  const { error } = await c.svc.from(table).update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: c.user.id,
    action: restore ? "restore_record" : "archive_record",
    targetTable: table,
    targetId: id,
    details: restore ? {} : { reason },
  });
  return NextResponse.json({ ok: true });
}

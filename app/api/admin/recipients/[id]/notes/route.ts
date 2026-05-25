// POST   /api/admin/recipients/[id]/notes — add note (admin/super_admin)
// DELETE /api/admin/recipients/[id]/notes?nid=... — delete (author or super_admin)
import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";

const MAX_NOTE = 4000;

async function authOrError() {
  try { return await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    throw e;
  }
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const rid = ctx.params.id;
  if (!rid) return NextResponse.json({ error: "id required" }, { status: 400 });
  const c = await authOrError();
  if ("error" in c) return c.error;
  const { user, ctx: orgCtx } = c;
  const svc = supabaseService();

  let body: { body?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const text = (body.body ?? "").trim();
  if (!text)                  return NextResponse.json({ error: "body required" }, { status: 400 });
  if (text.length > MAX_NOTE) return NextResponse.json({ error: `max ${MAX_NOTE} chars` }, { status: 400 });

  const { data: rec } = await svc.from("recipients")
    .select("id").eq("id", rid).eq("org_id", orgCtx.id).single();
  if (!rec) return NextResponse.json({ error: "recipient not found" }, { status: 404 });

  const { data: note, error } = await svc.from("recipient_notes")
    .insert({ org_id: orgCtx.id, recipient_id: rid, author_id: user.id, body: text })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id,
    action: "add_recipient_note",
    targetTable: "recipient_notes",
    targetId: note.id,
    details: { recipient_id: rid, length: text.length },
  });
  return NextResponse.json({ ok: true, note });
}

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const rid = ctx.params.id;
  const url = new URL(req.url);
  const nid = url.searchParams.get("nid");
  if (!rid || !nid) return NextResponse.json({ error: "id and nid required" }, { status: 400 });
  const c = await authOrError();
  if ("error" in c) return c.error;
  const { user, ctx: orgCtx } = c;
  const svc = supabaseService();

  // Look up platform-level role for the super_admin override.
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();

  const { data: note } = await svc.from("recipient_notes")
    .select("id, author_id, recipient_id").eq("id", nid).eq("org_id", orgCtx.id).single();
  if (!note || note.recipient_id !== rid) return NextResponse.json({ error: "note not found" }, { status: 404 });
  if (note.author_id !== user.id && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "only author or super_admin can delete" }, { status: 403 });
  }

  const { error } = await svc.from("recipient_notes").delete().eq("id", nid).eq("org_id", orgCtx.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    orgId: orgCtx.id,
    actorId: user.id,
    action: "delete_recipient_note",
    targetTable: "recipient_notes",
    targetId: nid,
    details: { recipient_id: rid },
  });
  return NextResponse.json({ ok: true });
}

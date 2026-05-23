// POST   /api/admin/applications/[id]/notes — create internal note
//   body: { body: string }
// DELETE /api/admin/applications/[id]/notes?nid=<note_id> — delete note (author or super_admin)
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";

const MAX_NOTE = 4000;

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const appId = ctx.params.id;
  if (!appId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { body?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const text = (body.body ?? "").trim();
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });
  if (text.length > MAX_NOTE) return NextResponse.json({ error: `max ${MAX_NOTE} chars` }, { status: 400 });

  const { data: app } = await svc.from("applications").select("id").eq("id", appId).single();
  if (!app) return NextResponse.json({ error: "application not found" }, { status: 404 });

  const { data: note, error } = await svc.from("application_notes")
    .insert({ application_id: appId, author_id: user.id, body: text })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: user.id,
    action: "add_note",
    targetTable: "application_notes",
    targetId: note.id,
    details: { application_id: appId, length: text.length },
  });

  return NextResponse.json({ ok: true, note });
}

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const appId = ctx.params.id;
  const url = new URL(req.url);
  const nid = url.searchParams.get("nid");
  if (!appId || !nid) return NextResponse.json({ error: "id and nid required" }, { status: 400 });

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Only author or super_admin can delete
  const { data: note } = await svc.from("application_notes")
    .select("id, author_id, application_id").eq("id", nid).single();
  if (!note || note.application_id !== appId) {
    return NextResponse.json({ error: "note not found" }, { status: 404 });
  }
  if (note.author_id !== user.id && profile.role !== "super_admin") {
    return NextResponse.json({ error: "only author or super_admin can delete" }, { status: 403 });
  }

  const { error } = await svc.from("application_notes").delete().eq("id", nid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId: user.id,
    action: "delete_note",
    targetTable: "application_notes",
    targetId: nid,
    details: { application_id: appId },
  });

  return NextResponse.json({ ok: true });
}

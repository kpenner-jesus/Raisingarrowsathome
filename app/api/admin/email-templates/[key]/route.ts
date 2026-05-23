// PATCH /api/admin/email-templates/[key]
//   body: { subject, body_html, body_text }
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit, diff } from "@/app/lib/audit";

export async function PATCH(req: Request, ctx: { params: { key: string } }) {
  const key = ctx.params.key;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const subject   = typeof body?.subject   === "string" ? body.subject.trim()    : null;
  const body_html = typeof body?.body_html === "string" ? body.body_html          : null;
  const body_text = typeof body?.body_text === "string" ? body.body_text          : null;
  if (!subject || subject.length === 0) return NextResponse.json({ error: "subject required" }, { status: 400 });
  if (!body_html || body_html.length === 0) return NextResponse.json({ error: "body_html required" }, { status: 400 });
  if (subject.length > 200)   return NextResponse.json({ error: "subject too long" }, { status: 400 });
  if (body_html.length > 50_000) return NextResponse.json({ error: "body_html too long" }, { status: 400 });
  if (body_text && body_text.length > 50_000) return NextResponse.json({ error: "body_text too long" }, { status: 400 });

  const { data: before } = await svc.from("email_templates")
    .select("subject, body_html, body_text").eq("key", key).single();
  if (!before) return NextResponse.json({ error: "template not found" }, { status: 404 });

  const { error } = await svc.from("email_templates").update({
    subject, body_html, body_text,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }).eq("key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit({
    actorId:     user.id,
    action:      "update_email_template",
    targetTable: "email_templates",
    targetId:    key,
    details:     diff(before, { subject, body_html, body_text }),
  });

  return NextResponse.json({ ok: true });
}

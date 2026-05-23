// POST /api/admin/broadcasts
//   body: { subject, body, audience }
// Sends via Resend, logs to broadcasts table, audits.
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { writeAudit } from "@/app/lib/audit";

const VALID_AUDIENCES = new Set(["active_recipients", "all_recipients", "admins"]);

export async function POST(req: Request) {
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const html    = typeof body?.body === "string" ? body.body : "";
  const audience = typeof body?.audience === "string" ? body.audience : "";

  if (!subject || subject.length > 200) return NextResponse.json({ error: "subject invalid" }, { status: 400 });
  if (!html    || html.length > 20_000) return NextResponse.json({ error: "body invalid" }, { status: 400 });
  if (!VALID_AUDIENCES.has(audience))    return NextResponse.json({ error: "audience invalid" }, { status: 400 });

  // Resolve audience list
  let recipients: { email: string; parent_names: string }[] = [];
  if (audience === "admins") {
    const { data } = await svc.from("profiles").select("email").in("role", ["admin", "super_admin"]);
    recipients = (data ?? []).map((r: any) => ({ email: r.email, parent_names: "Admin" }));
  } else {
    let q = svc.from("recipients").select(`applications!inner(parent_names, contact_email)`);
    if (audience === "active_recipients") q = q.eq("status", "active");
    const { data } = await q;
    recipients = (data ?? []).map((r: any) => ({
      email: r.applications.contact_email,
      parent_names: r.applications.parent_names,
    })).filter((r) => !!r.email);
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: "audience is empty" }, { status: 400 });
  }

  // Resend send via REST API
  const RESEND_KEY  = process.env.RESEND_API_KEY;
  const FROM_EMAIL  = process.env.RESEND_FROM || "Raising Arrows <register@raisingarrowsathome.com>";
  if (!RESEND_KEY) return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });

  // Personalize each send: substitute {{parent_names}}
  let sent = 0, failed = 0;
  for (const r of recipients) {
    const personalizedHtml = html.replaceAll("{{parent_names}}", escapeHtml(r.parent_names));
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to:   [r.email],
          subject,
          html: personalizedHtml,
        }),
      });
      if (res.ok) sent++;
      else        failed++;
    } catch {
      failed++;
    }
  }

  const { data: broadcast } = await svc.from("broadcasts").insert({
    sent_by: user.id, subject, body_html: html, audience,
    recipient_count: sent, failed_count: failed,
  }).select("id").single();

  await writeAudit({
    actorId:     user.id,
    action:      "send_broadcast",
    targetTable: "broadcasts",
    targetId:    broadcast?.id ?? "(unknown)",
    details:     { subject, audience, sent, failed },
  });

  return NextResponse.json({ ok: true, sent, failed });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// POST /api/admin/broadcasts/test-send
//   body: { subject, body }
// Sends ONE preview email to the currently-signed-in admin. Subject
// prefixed with "[TEST]" so it's never confused with a live broadcast.
// Does NOT write a broadcasts row.
import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/app/lib/admin/require-admin";
import { envTags } from "@/app/lib/email-env";

export async function POST(req: Request) {
  let auth;
  try { auth = await requireAdmin(); }
  catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  const { user } = auth;
  if (!user.email) return NextResponse.json({ error: "user has no email" }, { status: 400 });

  const body = await req.json().catch(() => ({} as any));
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const html    = typeof body?.body === "string"    ? body.body : "";
  if (!subject || !html) return NextResponse.json({ error: "subject + body required" }, { status: 400 });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.RESEND_FROM || "Raising Arrows <register@raisingarrowsathome.com>";
  if (!RESEND_KEY) return NextResponse.json({ error: "RESEND_API_KEY not configured" }, { status: 500 });

  const personalized = html.replaceAll("{{parent_names}}", "Test Family");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [user.email],
        subject: `[TEST] ${subject}`,
        html: personalized,
        tags: envTags(),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ error: `Resend ${res.status}: ${t.slice(0, 200)}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, sent_to: user.email });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "send failed" }, { status: 500 });
  }
}

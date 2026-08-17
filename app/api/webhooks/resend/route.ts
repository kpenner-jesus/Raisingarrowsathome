// POST /api/webhooks/resend
//
// Configure in Resend dashboard → Webhooks → endpoint URL:
//   https://raisingarrowsathome.com/api/webhooks/resend
// Set the signing secret to env RESEND_WEBHOOK_SECRET.
//
// Resend sends Svix-style headers:
//   svix-id, svix-timestamp, svix-signature ("v1,<base64sig> v1,<base64sig>")
// We verify HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`.
import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseService } from "@/app/lib/supabase/server";
import { shouldRecordEvent, emailEnv } from "@/app/lib/email-env";

export const runtime = "nodejs";
// Need raw body for signature check
export const dynamic = "force-dynamic";

const TYPE_MAP: Record<string, string> = {
  "email.sent":             "sent",
  "email.delivered":        "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced":          "bounced",
  "email.complained":       "complained",
  "email.opened":           "opened",
  "email.clicked":          "clicked",
  "email.failed":           "failed",
};

function verifySvix(secret: string, id: string, timestamp: string, body: string, sigHeader: string): boolean {
  if (!secret || !id || !timestamp || !sigHeader) return false;
  // Resend secret typically starts with 'whsec_' followed by base64
  const secretKey = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret);
  const signedPayload = `${id}.${timestamp}.${body}`;
  const expected = createHmac("sha256", secretKey).update(signedPayload).digest("base64");
  // sigHeader format: "v1,<sig> v1,<sig2>"
  const sigs = sigHeader.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
  return sigs.some((s) => {
    try {
      const a = Buffer.from(s, "base64");
      const b = Buffer.from(expected, "base64");
      return a.length === b.length && timingSafeEqual(a, b);
    } catch { return false; }
  });
}

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET || "";
  const sid    = req.headers.get("svix-id")        || "";
  const sts    = req.headers.get("svix-timestamp") || "";
  const ssig   = req.headers.get("svix-signature") || "";

  // If a secret is configured, require a valid signature. Otherwise accept
  // (useful for local testing) but only in non-production.
  if (secret) {
    if (!verifySvix(secret, sid, sts, raw, ssig)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 500 });
  }

  let payload: any;
  try { payload = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const evt: string = String(payload?.type || "");
  const data: any   = payload?.data || {};
  const event_type  = TYPE_MAP[evt] ?? evt.replace(/^email\./, "") ?? "unknown";

  // Production and staging share ONE Resend account, and a Resend webhook can
  // only be filtered by EVENT TYPE — not by sender, key, or environment. So
  // this endpoint (registered at the production URL) is fired for every email
  // the account sends, staging's included, and used to write them all into
  // whichever database this deployment talks to.
  //
  // Every send now carries an `env` tag; anything stamped with a DIFFERENT
  // environment is not ours to record. Untagged events are still recorded —
  // see shouldRecordEvent for why losing real history would be the worse bug.
  const decision = shouldRecordEvent(data);
  if (!decision.record) {
    console.log("[webhook/resend] ignoring event from another environment", {
      from: decision.from, self: emailEnv(), event: event_type,
    });
    // 200, not an error: the delivery succeeded, we simply have nothing to do.
    // A non-2xx would make Resend retry it forever.
    return NextResponse.json({ ok: true, ignored: "foreign-environment" });
  }

  const svc = supabaseService();
  const recipientEmail = Array.isArray(data.to) ? data.to[0] : (data.to ?? "");

  // Resend's payload carries no tenant context. Best-effort: resolve org_id by
  // matching the recipient email against an application's contact_email. If it
  // maps to exactly one org, stamp it; otherwise leave null (email_events.org_id
  // is nullable). The /admin/emails panel filters by org_id, so unresolved
  // events simply won't appear there but still persist for forensics/backfill.
  let orgId: string | null = null;
  if (recipientEmail) {
    const { data: apps } = await svc
      .from("applications")
      .select("org_id")
      .ilike("contact_email", recipientEmail)
      .limit(2);
    const distinct = Array.from(new Set((apps ?? []).map((a: any) => a.org_id)));
    if (distinct.length === 1) orgId = distinct[0] as string;
  }

  const { error: insErr } = await svc.from("email_events").insert({
    org_id:          orgId,
    resend_id:       String(data.email_id || data.id || ""),
    event_type,
    recipient_email: recipientEmail,
    subject:         String(data.subject || ""),
    payload:         data,
  });
  if (insErr) console.error("[webhook/resend] email_events insert failed:", insErr.message);

  return NextResponse.json({ ok: true });
}

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

  const svc = supabaseService();
  await svc.from("email_events").insert({
    resend_id:       String(data.email_id || data.id || ""),
    event_type,
    recipient_email: Array.isArray(data.to) ? data.to[0] : (data.to ?? ""),
    subject:         String(data.subject || ""),
    payload:         data,
  });

  return NextResponse.json({ ok: true });
}

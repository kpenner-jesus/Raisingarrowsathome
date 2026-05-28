// ============================================================
//  broadcasts.ts — send a queued broadcast.
//
//  Called both inline (admin clicked "Send now") and from the daily
//  cron dispatch (scheduled_for <= now()).
// ============================================================

import { supabaseService } from "./supabase/server";
import { signToken } from "./hmac";

interface SendArgs {
  broadcastId: string;
}

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://raisingarrowsathome.com";

interface SendResult {
  sent: number;
  failed: number;
  state: "sent" | "failed";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function sendBroadcast({ broadcastId }: SendArgs): Promise<SendResult> {
  const svc = supabaseService();

  // Claim the row: queued → sending. Returns null if it was already claimed.
  // We need org_id to scope every downstream lookup so a broadcast can never
  // accidentally pull recipients from a different tenant.
  const { data: claimed } = await svc.from("broadcasts")
    .update({ state: "sending" })
    .eq("id", broadcastId)
    .in("state", ["queued", "sending"])
    .select("id, org_id, subject, body_html, audience")
    .maybeSingle();
  if (!claimed) {
    return { sent: 0, failed: 0, state: "sent" };  // already processed
  }
  const orgId = (claimed as any).org_id as string;

  // Resolve recipients — every read is scoped to the broadcast's tenant.
  let recipients: { email: string; parent_names: string }[] = [];
  if (claimed.audience === "admins") {
    // Admin audience: pull from org_members (per-tenant role) joined to profiles
    // so we don't mass-mail platform-wide super_admins of other charities.
    const { data } = await svc
      .from("org_members")
      .select("profiles:profiles!org_members_user_id_fkey(email)")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"]);
    recipients = (data ?? []).map((r: any) => ({ email: r.profiles?.email, parent_names: "Admin" }))
      .filter((r) => !!r.email);
  } else {
    let q = svc.from("recipients").select(`applications!inner(parent_names, contact_email)`).eq("org_id", orgId);
    if (claimed.audience === "active_recipients") q = q.eq("status", "active");
    const { data } = await q;
    recipients = (data ?? []).map((r: any) => ({
      email: r.applications.contact_email,
      parent_names: r.applications.parent_names,
    })).filter((r) => !!r.email);
  }

  // Filter out anyone who opted out of THIS tenant's broadcasts. email_optouts
  // PK is now (org_id, email), so opt-outs are per-tenant — scope the read by
  // orgId so one tenant's unsubscribe doesn't silence another tenant's mail.
  if (recipients.length > 0) {
    const emails = recipients.map((r) => r.email.toLowerCase());
    const { data: opted } = await svc.from("email_optouts").select("email").eq("org_id", orgId).in("email", emails);
    const optedSet = new Set((opted ?? []).map((r: any) => r.email.toLowerCase()));
    recipients = recipients.filter((r) => !optedSet.has(r.email.toLowerCase()));
  }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.RESEND_FROM || "Raising Arrows <register@raisingarrowsathome.com>";
  if (!RESEND_KEY) {
    await svc.from("broadcasts").update({
      state: "failed", sent_at: new Date().toISOString(),
      recipient_count: 0, failed_count: recipients.length,
    }).eq("id", broadcastId);
    return { sent: 0, failed: recipients.length, state: "failed" };
  }

  // CASL / CAN-SPAM: every broadcast MUST carry an unsubscribe path.
  // Bail rather than mass-mail without one.
  try { signToken("probe", 60); }
  catch (e: any) {
    await svc.from("broadcasts").update({
      state: "failed", sent_at: new Date().toISOString(),
      recipient_count: 0, failed_count: recipients.length,
    }).eq("id", broadcastId);
    console.error("[broadcasts] aborting — HMAC secret missing, cannot sign unsubscribe links:", e?.message ?? e);
    return { sent: 0, failed: recipients.length, state: "failed" };
  }

  let sent = 0, failed = 0;
  for (const r of recipients) {
    // Token format `unsub:<orgId>:<email>` so /api/unsubscribe can scope
    // the email_optouts insert to the correct tenant. Legacy two-segment
    // tokens (`unsub:<email>`) are still accepted by the verifier as a
    // back-compat fallback — they default to the raising-arrows org.
    const unsubToken = signToken(`unsub:${orgId}:${r.email.toLowerCase()}`, 60 * 60 * 24 * 365);
    const unsubUrl = `${SITE}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
    const personalizedHtml = claimed.body_html.replaceAll("{{parent_names}}", escapeHtml(r.parent_names))
      + `<hr style="border:0;border-top:1px solid #eee;margin:36px 0 12px;">
         <p style="font-size:0.75rem;color:#aaa;margin:0;">
           You're receiving this because you're part of Raising Arrows.
           <a href="${unsubUrl}" style="color:#aaa;">Unsubscribe</a>
         </p>`;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      };
      const payload: any = {
        from: FROM_EMAIL, to: [r.email],
        subject: claimed.subject, html: personalizedHtml,
        headers: {
          "List-Unsubscribe":      `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", headers, body: JSON.stringify(payload),
      });
      if (res.ok) sent++; else failed++;
    } catch {
      failed++;
    }
  }

  const state: SendResult["state"] = failed > 0 && sent === 0 ? "failed" : "sent";
  await svc.from("broadcasts").update({
    state, sent_at: new Date().toISOString(),
    recipient_count: sent, failed_count: failed,
  }).eq("id", broadcastId).eq("org_id", orgId);

  return { sent, failed, state };
}

/** Find broadcasts whose scheduled_for has elapsed but state is still
 *  'queued', and send them. Returns per-broadcast result. */
export async function sendDueBroadcasts(): Promise<{ id: string; sent: number; failed: number }[]> {
  const svc = supabaseService();
  const { data: due } = await svc.from("broadcasts")
    .select("id")
    .eq("state", "queued")
    .lte("scheduled_for", new Date().toISOString());
  const out: { id: string; sent: number; failed: number }[] = [];
  for (const b of due ?? []) {
    const r = await sendBroadcast({ broadcastId: b.id });
    out.push({ id: b.id, sent: r.sent, failed: r.failed });
  }
  return out;
}

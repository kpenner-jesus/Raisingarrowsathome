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
  const { data: claimed } = await svc.from("broadcasts")
    .update({ state: "sending" })
    .eq("id", broadcastId)
    .in("state", ["queued", "sending"])
    .select("id, subject, body_html, audience")
    .maybeSingle();
  if (!claimed) {
    return { sent: 0, failed: 0, state: "sent" };  // already processed
  }

  // Resolve recipients
  let recipients: { email: string; parent_names: string }[] = [];
  if (claimed.audience === "admins") {
    const { data } = await svc.from("profiles").select("email").in("role", ["admin", "super_admin"]);
    recipients = (data ?? []).map((r: any) => ({ email: r.email, parent_names: "Admin" }));
  } else {
    let q = svc.from("recipients").select(`applications!inner(parent_names, contact_email)`);
    if (claimed.audience === "active_recipients") q = q.eq("status", "active");
    const { data } = await q;
    recipients = (data ?? []).map((r: any) => ({
      email: r.applications.contact_email,
      parent_names: r.applications.parent_names,
    })).filter((r) => !!r.email);
  }

  // Filter out anyone who opted out of broadcasts.
  if (recipients.length > 0) {
    const emails = recipients.map((r) => r.email.toLowerCase());
    const { data: opted } = await svc.from("email_optouts").select("email").in("email", emails);
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

  let sent = 0, failed = 0;
  for (const r of recipients) {
    let unsubToken = "";
    try { unsubToken = signToken(`unsub:${r.email.toLowerCase()}`, 60 * 60 * 24 * 365); } catch {}
    const unsubUrl = `${SITE}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
    const personalizedHtml = claimed.body_html.replaceAll("{{parent_names}}", escapeHtml(r.parent_names))
      + `<hr style="border:0;border-top:1px solid #eee;margin:36px 0 12px;">
         <p style="font-size:0.75rem;color:#aaa;margin:0;">
           You're receiving this because you're part of Raising Arrows.
           ${unsubToken ? `<a href="${unsubUrl}" style="color:#aaa;">Unsubscribe</a>` : ""}
         </p>`;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      };
      const payload: any = {
        from: FROM_EMAIL, to: [r.email],
        subject: claimed.subject, html: personalizedHtml,
      };
      if (unsubToken) {
        payload.headers = {
          "List-Unsubscribe":      `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        };
      }
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
  }).eq("id", broadcastId);

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

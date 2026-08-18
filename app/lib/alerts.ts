// ============================================================
//  alerts.ts — instant admin notifications for time-sensitive events.
//
//  Two delivery channels, both optional + fire-and-forget:
//   - Slack: env SLACK_WEBHOOK_URL  (incoming-webhook URL)
//   - Email: env ADMIN_ALERT_EMAILS (comma-separated list)
//
//  Falls silently if neither is configured. Failures never bubble up.
// ============================================================

import { Resend } from "resend";
import { envTags, routeRecipients, routedSubject, routedNotice, stagingRedirectTarget } from "@/app/lib/email-env";

interface AlertPayload {
  title:   string;
  summary: string;
  url?:    string;        // link admin can click
  fields?: { label: string; value: string }[];
}

const FROM_DEFAULT = "Raising Arrows <onboarding@resend.dev>";

export async function sendAdminAlert(p: AlertPayload): Promise<void> {
  await Promise.all([slackAlert(p), emailAlert(p)]);
}

async function slackAlert(p: AlertPayload): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const blocks: any[] = [
      { type: "header", text: { type: "plain_text", text: p.title, emoji: true } },
      { type: "section", text: { type: "mrkdwn", text: p.summary } },
    ];
    if (p.fields && p.fields.length > 0) {
      blocks.push({
        type: "section",
        fields: p.fields.map((f) => ({ type: "mrkdwn", text: `*${f.label}*\n${f.value}` })),
      });
    }
    if (p.url) {
      blocks.push({ type: "actions", elements: [{
        type: "button",
        text: { type: "plain_text", text: "Open in admin", emoji: true },
        url: p.url,
        style: "primary",
      }] });
    }
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: p.title + " — " + p.summary, blocks }),
    });
  } catch (e: any) {
    console.error("[alerts.slack] failed:", e?.message ?? e);
  }
}

async function emailAlert(p: AlertPayload): Promise<void> {
  const list = (process.env.ADMIN_ALERT_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return;
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const from = process.env.RESEND_FROM || FROM_DEFAULT;

  const fieldsHtml = (p.fields ?? []).map((f) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#666;font-size:0.85rem;">${esc(f.label)}</td>
      <td style="padding:4px 0;font-size:0.92rem;">${esc(f.value)}</td></tr>`
  ).join("");

  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:24px auto;padding:0 20px;color:#1a1a1a;line-height:1.6;">
    <h2 style="font-family:Georgia,serif;color:#e8793a;font-size:1.3rem;margin:0 0 6px;">${esc(p.title)}</h2>
    <p style="margin:0 0 18px;">${esc(p.summary)}</p>
    ${fieldsHtml ? `<table style="border-collapse:collapse;">${fieldsHtml}</table>` : ""}
    ${p.url ? `<p style="margin:22px 0;"><a href="${esc(p.url)}" style="background:#e8793a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:100px;display:inline-block;">Open in admin</a></p>` : ""}
  </body></html>`;

  try {
    const client = new Resend(key);
    const redirectTo = await stagingRedirectTarget();
    await Promise.all(list.map((to) => {
      const routing = routeRecipients(to, { redirectTo });
      if (!routing.send) {
        console.warn("[alerts.email] not delivered:", routing.reason, { wouldHaveGoneTo: routing.wouldHaveGoneTo });
        return Promise.resolve();
      }
      return client.emails.send({
        from,
        to: routing.to,
        subject: routedSubject(`[Raising Arrows] ${p.title}`, routing),
        html: routedNotice(routing) + html,
        tags: envTags(),
      }).catch((e) => console.error("[alerts.email] send failed:", routing.to, e?.message ?? e));
    }));
  } catch (e: any) {
    console.error("[alerts.email] init failed:", e?.message ?? e);
  }
}

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

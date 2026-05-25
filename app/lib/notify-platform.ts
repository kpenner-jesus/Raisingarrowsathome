// ============================================================
//  notify-platform.ts — platform-side emails (welcome, trial reminders,
//  past-due nudges). Distinct from notify.ts which handles tenant-to-
//  recipient emails routed through each tenant's verified sender.
//
//  These ALWAYS go from the platform sender (RESEND_FROM env) because
//  they're about the platform itself (welcome you to the platform,
//  trial ending, payment failed). Not from the tenant's domain.
// ============================================================

import { Resend } from "resend";

function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

const PLATFORM_FROM = process.env.RESEND_FROM || "Raising Arrows Platform <onboarding@resend.dev>";

function esc(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrap(body: string): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.65;color:#1a1a1a;max-width:560px;margin:24px auto;padding:0 20px;background:#fff;">
  <h1 style="font-family:Georgia,serif;font-style:italic;color:#e8793a;font-size:1.5rem;font-weight:500;margin:0 0 24px;">Raising Arrows Platform</h1>
  ${body}
  <hr style="border:0;border-top:1px solid #eee;margin:36px 0 16px;">
  <p style="font-size:0.78rem;color:#888;margin:0;">All platform revenue is donated to <a href="https://raisingarrowsathome.com" style="color:#e8793a;">Raising Arrows</a> — a CRA-registered charity helping Christian families launch into homeschooling.</p>
</body></html>`;
}

function button(label: string, href: string): string {
  return `<p style="margin:24px 0;"><a href="${esc(href)}" style="background:#e8793a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:100px;display:inline-block;font-weight:500;">${esc(label)}</a></p>`;
}

async function platformSend(to: string, subject: string, html: string) {
  if (!to) return;
  const client = resend();
  if (!client) {
    console.warn("[notify-platform] RESEND_API_KEY missing — skipping", { to, subject });
    return;
  }
  try {
    const { error } = await client.emails.send({ from: PLATFORM_FROM, to, subject, html });
    if (error) console.error("[notify-platform] Resend error", error, { to, subject });
  } catch (err: any) {
    console.error("[notify-platform] Resend exception", err?.message || err, { to, subject });
  }
}

/** Sent immediately after a new tenant signs up. */
export async function sendWelcomeToNewOrgOwner(args: {
  to: string;
  orgName: string;
  slug: string;
  adminUrl: string;
  trialEndsAt: Date;
}) {
  const trialDate = args.trialEndsAt.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });
  await platformSend(
    args.to,
    `Welcome to the Raising Arrows Platform — ${args.orgName}`,
    wrap(`
      <p>Welcome,</p>
      <p>Your organization <strong>${esc(args.orgName)}</strong> is set up. You're the owner.</p>
      <p>Your 14-day free trial runs until <strong>${esc(trialDate)}</strong>. No card needed during the trial.</p>
      ${button("Open your admin", args.adminUrl)}
      <p><strong>Next steps:</strong></p>
      <ol style="padding-left:20px;">
        <li><a href="${esc(args.adminUrl)}/settings/branding" style="color:#e8793a;">Add your logo + accent colour</a> (5 min)</li>
        <li><a href="${esc(args.adminUrl)}/settings/email-domain" style="color:#e8793a;">Verify your sending domain</a> so emails come from your own address (15 min)</li>
        <li><a href="${esc(args.adminUrl)}/email-templates" style="color:#e8793a;">Review email templates</a> — defaults are decent but worth a once-over</li>
        <li>Share <code>/o/${esc(args.slug)}/apply/family</code> with families ready to apply</li>
      </ol>
      <p>Questions? Reply to this email — it goes straight to a real person.</p>
      <p>— Kevin, Raising Arrows Platform</p>
    `),
  );
}

/** Sent 3 days before trial_ends_at. */
export async function sendTrialEndingSoon(args: {
  to: string;
  orgName: string;
  daysLeft: number;
  billingUrl: string;
}) {
  await platformSend(
    args.to,
    `${args.orgName} — ${args.daysLeft} day${args.daysLeft === 1 ? "" : "s"} left in your trial`,
    wrap(`
      <p>Heads up — your free trial for <strong>${esc(args.orgName)}</strong> ends in <strong>${args.daysLeft} day${args.daysLeft === 1 ? "" : "s"}</strong>.</p>
      <p>Add a payment method now and keep everything running. $20 USD/month, all revenue to Raising Arrows.</p>
      ${button("Upgrade now", args.billingUrl)}
      <p>If you'd rather not continue, no action needed — your portal will pause automatically when the trial ends.</p>
    `),
  );
}

/** Sent when invoice.payment_failed comes from Stripe. */
export async function sendPastDueNudge(args: {
  to: string;
  orgName: string;
  billingUrl: string;
}) {
  await platformSend(
    args.to,
    `Action needed — payment failed for ${args.orgName}`,
    wrap(`
      <p>Your last subscription payment for <strong>${esc(args.orgName)}</strong> didn't go through.</p>
      <p>Update your card to keep your portal active:</p>
      ${button("Update payment method", args.billingUrl)}
      <p>If we can't process payment within 7 days, the portal will pause until billing is resolved.</p>
    `),
  );
}

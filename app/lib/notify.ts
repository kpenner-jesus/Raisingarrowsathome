// ============================================================
//  notify.ts — server-side transactional email via Resend
//
//  Resend free tier: 3,000/mo, 100/day, unlimited templates
//  (they live here as HTML strings — no dashboard limits).
//
//  All sends are fire-and-forget: failures are logged but never
//  raised — admin decisions must succeed even if email fails.
// ============================================================

import { Resend } from "resend";

const FROM_DEFAULT = "Raising Arrows <onboarding@resend.dev>";

function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

interface SendOpts {
  to:      string;
  subject: string;
  html:    string;
}

async function send({ to, subject, html }: SendOpts) {
  const client = resend();
  if (!client) {
    console.warn("[notify] RESEND_API_KEY missing — skipping", { to, subject });
    return;
  }
  const from = process.env.RESEND_FROM || FROM_DEFAULT;
  try {
    const { error } = await client.emails.send({ from, to, subject, html });
    if (error) console.error("[notify] Resend error", error, { to, subject });
  } catch (err: any) {
    console.error("[notify] Resend exception", err?.message || err, { to, subject });
  }
}

// ──────────────────────────────────────────────────────────────
//  HTML template helpers
// ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrap(body: string): string {
  return `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.65;color:#1a1a1a;max-width:560px;margin:24px auto;padding:0 20px;background:#fff;">
  <h1 style="font-family:Georgia,'Playfair Display',serif;font-style:italic;color:#e8793a;font-size:1.7rem;font-weight:500;margin:0 0 24px;letter-spacing:-0.01em;">Raising Arrows</h1>
  ${body}
  <hr style="border:0;border-top:1px solid #eee;margin:36px 0 16px;">
  <p style="font-size:0.8rem;color:#888;margin:0;">Raising Arrows · <a href="mailto:register@raisingarrowsathome.com" style="color:#888;">register@raisingarrowsathome.com</a></p>
  <p style="font-size:0.75rem;color:#aaa;margin:8px 0 0;">In association with CEO Ministries — the registered charity behind Raising Arrows.</p>
</body>
</html>`;
}

function button(label: string, href: string): string {
  return `<p style="margin:24px 0;"><a href="${esc(href)}" style="background:#e8793a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:100px;display:inline-block;font-weight:500;">${esc(label)}</a></p>`;
}

// ──────────────────────────────────────────────────────────────
//  Typed event helpers — one per admin-decision event.
//  Signatures unchanged from prior EmailJS version so callers
//  in /api routes do not need updating.
// ──────────────────────────────────────────────────────────────

export async function notifyApplicationApproved(args: {
  to: string;
  parent_names: string;
  approved_amount: number;
  rate: number;
  portal_url: string;
}) {
  await send({
    to: args.to,
    subject: "Your Raising Arrows grant has been approved",
    html: wrap(`
      <p>Hi ${esc(args.parent_names)},</p>
      <p>Welcome to Raising Arrows. We're excited to walk alongside your family as you start homeschooling.</p>
      <p style="background:#fdf3e3;border-left:3px solid #e8793a;padding:12px 16px;margin:20px 0;">
        <strong>Approved grant amount:</strong> $${args.approved_amount.toFixed(2)}<br>
        <strong>Reimbursement rate:</strong> ${(args.rate * 100).toFixed(0)}% of qualifying receipts
      </p>
      <p>Sign in to your recipient portal to upload receipts, photos, and testimonials, and track your balance.</p>
      ${button("Open your portal", args.portal_url)}
      <p>You'll receive a separate email shortly with a one-click sign-in link.</p>
      <p>In Him,<br>The Raising Arrows team</p>
    `),
  });
}

export async function notifyApplicationDenied(args: {
  to: string;
  parent_names: string;
  admin_notes: string;
}) {
  await send({
    to: args.to,
    subject: "An update on your Raising Arrows application",
    html: wrap(`
      <p>Hi ${esc(args.parent_names)},</p>
      <p>Thank you for applying to Raising Arrows. After careful review, we're unable to fund your application at this time.</p>
      ${args.admin_notes ? `<p style="background:#f7f7f7;border-left:3px solid #ccc;padding:12px 16px;margin:20px 0;white-space:pre-wrap;">${esc(args.admin_notes)}</p>` : ""}
      <p>We pray God's blessing on your family's journey.</p>
      <p>The Raising Arrows team</p>
    `),
  });
}

export async function notifyReceiptApproved(args: {
  to: string;
  parent_names: string;
  amount: number;
  description: string;
  portal_url: string;
}) {
  await send({
    to: args.to,
    subject: "Your receipt has been approved",
    html: wrap(`
      <p>Hi ${esc(args.parent_names)},</p>
      <p>Good news — we've approved your receipt for <strong>$${args.amount.toFixed(2)}</strong>${args.description ? ` (${esc(args.description)})` : ""}.</p>
      <p>The eligible portion will be added to your next monthly payout. You can see your updated balance in your portal:</p>
      ${button("View your balance", args.portal_url)}
      <p>The Raising Arrows team</p>
    `),
  });
}

export async function notifyReceiptRejected(args: {
  to: string;
  parent_names: string;
  amount: number;
  description: string;
  admin_notes: string;
  portal_url: string;
}) {
  await send({
    to: args.to,
    subject: "A note about your recent receipt",
    html: wrap(`
      <p>Hi ${esc(args.parent_names)},</p>
      <p>We reviewed your receipt for <strong>$${args.amount.toFixed(2)}</strong>${args.description ? ` (${esc(args.description)})` : ""} and were unable to approve it.</p>
      ${args.admin_notes ? `<p style="background:#f7f7f7;border-left:3px solid #ccc;padding:12px 16px;margin:20px 0;white-space:pre-wrap;">${esc(args.admin_notes)}</p>` : ""}
      <p>You can upload a different receipt anytime from your portal.</p>
      ${button("Upload another receipt", args.portal_url)}
      <p>If you have questions, just reply to this email.</p>
      <p>The Raising Arrows team</p>
    `),
  });
}

export async function notifyBatchPaid(args: {
  to: string;
  parent_names: string;
  amount: number;
  portal_url: string;
}) {
  await send({
    to: args.to,
    subject: "Your Raising Arrows payout is on the way",
    html: wrap(`
      <p>Hi ${esc(args.parent_names)},</p>
      <p>An e-transfer of <strong>$${args.amount.toFixed(2)}</strong> is on its way to you from CEO Ministries (the registered charity behind Raising Arrows).</p>
      <p>You should see it in your account within 1–3 business days.</p>
      ${button("View your balance", args.portal_url)}
      <p>Thank you for letting us be part of your family's homeschool journey.</p>
      <p>The Raising Arrows team</p>
    `),
  });
}

// ──────────────────────────────────────────────────────────────
//  Admin-facing: bi-monthly submission-window summary to Tierza
// ──────────────────────────────────────────────────────────────

export async function notifySubmissionWindowSummary(args: {
  to: string;
  bucket_label: string;
  pay_date_description: string;
  pending_for_review:       { name: string; amount: string; desc: string }[];
  approved_awaiting_payout: { name: string; reimbursable_cad: string; desc: string }[];
  admin_url: string;
}) {
  const pendingRows = args.pending_for_review.length === 0
    ? `<p style="color:#888;font-style:italic;">No receipts awaiting your review.</p>`
    : `<table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin:8px 0;">
        <thead><tr style="text-align:left;border-bottom:1px solid #ddd;">
          <th style="padding:6px 8px;">Family</th><th style="padding:6px 8px;">Amount</th><th style="padding:6px 8px;">Description</th>
        </tr></thead>
        <tbody>${args.pending_for_review.map((r) => `<tr style="border-bottom:1px solid #f3f3f3;">
          <td style="padding:6px 8px;">${esc(r.name)}</td>
          <td style="padding:6px 8px;">${esc(r.amount)}</td>
          <td style="padding:6px 8px;color:#666;">${esc(r.desc)}</td>
        </tr>`).join("")}</tbody>
      </table>`;

  const approvedRows = args.approved_awaiting_payout.length === 0
    ? `<p style="color:#888;font-style:italic;">No approved receipts queued for payout.</p>`
    : `<table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin:8px 0;">
        <thead><tr style="text-align:left;border-bottom:1px solid #ddd;">
          <th style="padding:6px 8px;">Family</th><th style="padding:6px 8px;">Reimbursable (CAD)</th><th style="padding:6px 8px;">Description</th>
        </tr></thead>
        <tbody>${args.approved_awaiting_payout.map((r) => `<tr style="border-bottom:1px solid #f3f3f3;">
          <td style="padding:6px 8px;">${esc(r.name)}</td>
          <td style="padding:6px 8px;">${esc(r.reimbursable_cad)}</td>
          <td style="padding:6px 8px;color:#666;">${esc(r.desc)}</td>
        </tr>`).join("")}</tbody>
      </table>`;

  await send({
    to: args.to,
    subject: `Raising Arrows — ${esc(args.bucket_label)} payout window`,
    html: wrap(`
      <p>Hi Tierza,</p>
      <p>The submission window for <strong>${esc(args.bucket_label)}</strong> is now closing. Payouts run on ${esc(args.pay_date_description)}.</p>

      <h3 style="font-family:Georgia,serif;font-size:1.1rem;margin-top:24px;color:#1a1a1a;">
        ${args.pending_for_review.length} receipt${args.pending_for_review.length === 1 ? "" : "s"} awaiting your review
      </h3>
      ${pendingRows}

      <h3 style="font-family:Georgia,serif;font-size:1.1rem;margin-top:24px;color:#1a1a1a;">
        ${args.approved_awaiting_payout.length} approved receipt${args.approved_awaiting_payout.length === 1 ? "" : "s"} queued for this payout
      </h3>
      ${approvedRows}

      ${button("Open admin", args.admin_url)}

      <p>The Raising Arrows portal</p>
    `),
  });
}

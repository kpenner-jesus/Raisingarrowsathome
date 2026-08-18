// ============================================================
//  notify.ts — server-side transactional email via Resend
//
//  Resend free tier: 3,000/mo, 100/day, unlimited templates.
//
//  Each notify*() function:
//   1. Tries to load its template from public.email_templates (DB).
//   2. Falls back to the hardcoded HTML below if the template is
//      missing or the DB read fails.
//   3. Wraps the rendered inner-HTML in the shared brand chrome.
//
//  All sends are fire-and-forget: failures are logged but never
//  raised — admin decisions must succeed even if email fails.
// ============================================================

import { Resend } from "resend";
import { envTags, routeRecipients, routedSubject, routedNotice } from "@/app/lib/email-env";
import { supabaseService } from "./supabase/server";

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
  /** Tenant id — when provided, the from-address falls back to the
   *  tenant's verified sender (if any) before the env default. */
  orgId?:  string | null;
}

/**
 * Resolve the from-address for an outbound email.
 *  1. If orgId given AND that tenant has sender_email + sender_verified=true
 *     → use "<tenant.name> <tenant.sender_email>".
 *  2. Else → RESEND_FROM env (platform shared sender).
 *  3. Else → FROM_DEFAULT (Resend sandbox; should only hit in local dev).
 */
async function resolveFrom(orgId?: string | null): Promise<string> {
  if (orgId) {
    try {
      const svc = supabaseService();
      const { data } = await svc.from("tenants")
        .select("name, sender_email, sender_verified")
        .eq("id", orgId)
        .maybeSingle();
      if (data?.sender_verified && data.sender_email) {
        // Resend allows "Display Name <email@domain>" syntax.
        const safeName = String(data.name || "").replace(/[<>]/g, "").slice(0, 80);
        return safeName ? `${safeName} <${data.sender_email}>` : data.sender_email;
      }
    } catch (e) {
      console.warn("[notify] tenant sender lookup failed:", (e as any)?.message || e);
    }
  }
  return process.env.RESEND_FROM || FROM_DEFAULT;
}

/**
 * Send one email. Returns whether it ACTUALLY went out.
 *
 * This used to return void: the Resend SDK reports failures as `{ error }`
 * rather than throwing, so a rejected send was logged and then reported to the
 * caller as success. Callers that count — bulk-deny, mark-batch-paid — told the
 * admin every family had been emailed when Resend had rate-limited almost all
 * of them (its default is 2 requests/second, and bulk-deny fanned out with
 * Promise.all). The audit log recorded notifications that never happened.
 *
 * Existing callers that ignore the return value behave exactly as before.
 */
async function send({ to, subject, html, orgId }: SendOpts): Promise<boolean> {
  const client = resend();
  if (!client) {
    console.warn("[notify] RESEND_API_KEY missing — skipping", { to, subject });
    return false;
  }
  const from = await resolveFrom(orgId);

  // Outside production, never deliver to the address on the record. Staging's
  // database is a clone, so that address belongs to a REAL family who would
  // have no way of knowing the message was somebody practising.
  const routing = routeRecipients(to);
  if (!routing.send) {
    console.warn("[notify] not delivered:", routing.reason, { wouldHaveGoneTo: routing.wouldHaveGoneTo, subject });
    return false;
  }

  try {
    const { error } = await client.emails.send({
      from,
      to: routing.to,
      subject: routedSubject(subject, routing),
      html: routedNotice(routing) + html,
      tags: envTags(),
    });
    if (error) {
      console.error("[notify] Resend error", error, { to: routing.to, subject, from });
      return false;
    }
    return true;
  } catch (err: any) {
    console.error("[notify] Resend exception", err?.message || err, { to, subject, from });
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
//  Template loading + var substitution
// ──────────────────────────────────────────────────────────────

function esc(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replace every {{var}} with vars[var]. By default values are HTML-escaped.
 *  Keys listed in `raw` are inserted as-is (admin-supplied HTML body etc). */
function substitute(template: string, vars: Record<string, any>, raw: Set<string> = new Set()): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return "";
    return raw.has(key) ? String(value) : esc(value);
  });
}

interface LoadedTemplate {
  subject: string;
  body_html: string;
  body_text: string | null;
}

async function loadTemplate(key: string, orgId?: string | null): Promise<LoadedTemplate | null> {
  try {
    const svc = supabaseService();
    // Scope to tenant when we know which one — email_templates now has
    // a UNIQUE(org_id, key) constraint, so multiple rows could share a key.
    // select("*") rather than naming archived_at: migrations are applied by
    // hand, so this may run against a database that predates that column, and
    // naming it would error out every templated email at once.
    let q = svc.from("email_templates").select("*").eq("key", key);
    if (orgId) q = q.eq("org_id", orgId);
    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;
    // Archived = retired on purpose: fall back to the hardcoded copy rather
    // than sending wording someone withdrew.
    if (data.archived_at) return null;
    return { subject: data.subject, body_html: data.body_html, body_text: data.body_text };
  } catch {
    return null;
  }
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

/** Common dispatch:
 *   - Try to load `key` from email_templates scoped to orgId.
 *   - Substitute vars (vars in `raw` are inserted unescaped).
 *   - If DB template missing, call the fallback closure.
 *   - Either way the inner body is wrapped in the brand chrome.
 *   - When orgId is supplied, the from-address is the tenant's verified
 *     sender (if any); otherwise the platform shared sender. */
async function sendTemplated(opts: {
  to: string;
  key: string;
  vars: Record<string, any>;
  raw?: Set<string>;
  fallback: () => { subject: string; html: string };
  orgId?: string | null;
}): Promise<boolean> {
  const tpl = await loadTemplate(opts.key, opts.orgId);
  if (tpl) {
    const subject = substitute(tpl.subject, opts.vars).trim();
    const innerHtml = substitute(tpl.body_html, opts.vars, opts.raw);
    return send({ to: opts.to, subject: subject || "Raising Arrows", html: wrap(innerHtml), orgId: opts.orgId });
  }
  const fb = opts.fallback();
  return send({ to: opts.to, subject: fb.subject, html: wrap(fb.html), orgId: opts.orgId });
}

// ──────────────────────────────────────────────────────────────
//  Typed event helpers — DB template with hardcoded fallback.
// ──────────────────────────────────────────────────────────────

export async function notifyApplicationApproved(args: {
  to: string;
  parent_names: string;
  approved_amount: number;
  rate: number;
  portal_url: string;
  deadline?: string | null;
  org_name?: string | null;
  orgId?: string | null;
}) {
  const amount   = `$${args.approved_amount.toFixed(2)}`;
  const ratePct  = `${(args.rate * 100).toFixed(0)}%`;
  const orgName  = args.org_name || "Raising Arrows";
  const deadline = args.deadline || "";
  return sendTemplated({
    to: args.to,
    key: "application_approved",
    orgId: args.orgId,
    vars: {
      parent_names:    args.parent_names,
      approved_amount: amount,
      rate:            ratePct,
      deadline,
      portal_url:      args.portal_url,
      org_name:        orgName,
    },
    fallback: () => ({
      subject: `Your grant is approved — welcome to ${orgName}`,
      html: `
        <p>Hi ${esc(args.parent_names)},</p>
        <p>Your application is approved and your portal is ready. Here is what you have to work with.</p>
        <p style="background:#fdf3e3;border-left:3px solid #e8793a;padding:12px 16px;margin:20px 0;">
          <strong>Your grant:</strong> ${esc(amount)}<br>
          <strong>You get back:</strong> ${esc(ratePct)} of what you spend on qualifying items
          ${deadline ? `<br><strong>Send receipts by:</strong> ${esc(deadline)}` : ""}
        </p>
        <p><strong>How it works</strong></p>
        <ol>
          <li>Buy the curriculum and supplies your family needs.</li>
          <li>Take a photo of the receipt, or save the PDF.</li>
          <li>Upload it in your portal. We review it and it goes into your balance.</li>
        </ol>
        <p>Your portal also shows what has been paid, what is still being checked, and how much of your grant is left.</p>
        ${button("Open your portal", args.portal_url)}
        <p>There is no password to remember. You will get a separate email with a sign-in link — click it and you are in.</p>
        <p>If anything is unclear, just reply to this email. We would rather answer a small question early than have you wait.</p>
        <p>In Him,<br>The ${esc(orgName)} team</p>`,
    }),
  });
}

export async function notifyApplicationReceived(args: {
  to: string;
  parent_names: string;
  app_ref: string;
  withdraw_url: string;
  orgId?: string | null;
}) {
  await send({
    to: args.to,
    orgId: args.orgId,
    subject: "We received your Raising Arrows application",
    html: wrap(`
      <p>Hi ${esc(args.parent_names)},</p>
      <p>Thanks for applying. Your application reference is <strong>${esc(args.app_ref)}</strong>.</p>
      <p>Our admin team will review within ~2 weeks. You'll hear back by email either way.</p>
      <p style="font-size:0.85rem;color:#666;margin-top:32px;">Changed your mind?
        <a href="${esc(args.withdraw_url)}" style="color:#666;">Withdraw this application</a>.
      </p>
      <p>In Him,<br>The Raising Arrows team</p>
    `),
  });
}

export async function notifyApplicationDenied(args: {
  to: string;
  parent_names: string;
  admin_notes: string;
  orgId?: string | null;
}) {
  return sendTemplated({
    to: args.to,
    key: "application_denied",
    orgId: args.orgId,
    vars: {
      parent_names: args.parent_names,
      admin_notes:  args.admin_notes,
    },
    fallback: () => ({
      subject: "An update on your Raising Arrows application",
      html: `
        <p>Hi ${esc(args.parent_names)},</p>
        <p>Thank you for applying to Raising Arrows. After careful review, we're unable to fund your application at this time.</p>
        ${args.admin_notes ? `<p style="background:#f7f7f7;border-left:3px solid #ccc;padding:12px 16px;margin:20px 0;white-space:pre-wrap;">${esc(args.admin_notes)}</p>` : ""}
        <p>We pray God's blessing on your family's journey.</p>
        <p>The Raising Arrows team</p>`,
    }),
  });
}

export async function notifyReceiptApproved(args: {
  to: string;
  parent_names: string;
  amount: number;
  description: string;
  portal_url: string;
  orgId?: string | null;
}) {
  const amount = args.amount.toFixed(2);
  return sendTemplated({
    to: args.to,
    key: "receipt_approved",
    orgId: args.orgId,
    vars: {
      parent_names: args.parent_names,
      amount,
      description:  args.description,
      portal_url:   args.portal_url,
    },
    fallback: () => ({
      subject: "Your receipt has been approved",
      html: `
        <p>Hi ${esc(args.parent_names)},</p>
        <p>Good news — we've approved your receipt for <strong>$${esc(amount)}</strong>${args.description ? ` (${esc(args.description)})` : ""}.</p>
        <p>The eligible portion will be added to your next monthly payout. You can see your updated balance in your portal:</p>
        ${button("View your balance", args.portal_url)}
        <p>The Raising Arrows team</p>`,
    }),
  });
}

export async function notifyReceiptRejected(args: {
  to: string;
  parent_names: string;
  amount: number;
  description: string;
  admin_notes: string;
  portal_url: string;
  orgId?: string | null;
}) {
  const amount = args.amount.toFixed(2);
  return sendTemplated({
    to: args.to,
    key: "receipt_rejected",
    orgId: args.orgId,
    vars: {
      parent_names: args.parent_names,
      amount,
      description:  args.description,
      admin_notes:  args.admin_notes,
      portal_url:   args.portal_url,
    },
    fallback: () => ({
      subject: "A note about your recent receipt",
      html: `
        <p>Hi ${esc(args.parent_names)},</p>
        <p>We reviewed your receipt for <strong>$${esc(amount)}</strong>${args.description ? ` (${esc(args.description)})` : ""} and were unable to approve it.</p>
        ${args.admin_notes ? `<p style="background:#f7f7f7;border-left:3px solid #ccc;padding:12px 16px;margin:20px 0;white-space:pre-wrap;">${esc(args.admin_notes)}</p>` : ""}
        <p>You can upload a different receipt anytime from your portal.</p>
        ${button("Upload another receipt", args.portal_url)}
        <p>If you have questions, just reply to this email.</p>
        <p>The Raising Arrows team</p>`,
    }),
  });
}

export async function notifyBatchPaid(args: {
  to: string;
  parent_names: string;
  amount: number;
  portal_url: string;
  orgId?: string | null;
}) {
  const amount = args.amount.toFixed(2);
  return sendTemplated({
    to: args.to,
    key: "batch_paid",
    orgId: args.orgId,
    vars: {
      parent_names: args.parent_names,
      amount,
      portal_url:   args.portal_url,
    },
    fallback: () => ({
      subject: "Your Raising Arrows payout is on the way",
      html: `
        <p>Hi ${esc(args.parent_names)},</p>
        <p>An e-transfer of <strong>$${esc(amount)}</strong> is on its way to you from CEO Ministries (the registered charity behind Raising Arrows).</p>
        <p>You should see it in your account within 1–3 business days.</p>
        ${button("View your balance", args.portal_url)}
        <p>Thank you for letting us be part of your family's homeschool journey.</p>
        <p>The Raising Arrows team</p>`,
    }),
  });
}

// ──────────────────────────────────────────────────────────────
//  Admin-facing: bi-monthly submission-window summary to Tierza
//  (stays hardcoded — operational and complex, not user-edited)
// ──────────────────────────────────────────────────────────────

export async function notifySubmissionWindowSummary(args: {
  to: string;
  bucket_label: string;
  pay_date_description: string;
  pending_for_review:       { name: string; amount: string; desc: string }[];
  approved_awaiting_payout: { name: string; reimbursable_cad: string; desc: string }[];
  admin_url: string;
  orgId?:    string | null;
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
    to:     args.to,
    orgId:  args.orgId ?? null,
    subject: `${esc(args.bucket_label)} payout window — summary`,
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


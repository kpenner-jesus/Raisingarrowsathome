// ============================================================
//  summary-emails.ts — per-tenant bi-monthly submission-window summary.
//
//  For each tenant we email the owner (or the configured summary_email_to
//  app_setting) a list of pending + approved receipts so they know what's
//  coming up in the next payout window.
// ============================================================

import { supabaseService } from "./supabase/server";
import { notifySubmissionWindowSummary } from "./notify";

export type SummaryBucket = "mid" | "end";

export interface SummaryResult {
  org_id:                  string;
  slug:                    string;
  pending_count:           number;
  approved_awaiting_count: number;
  sent:                    boolean;
  reason?:                 string;
}

async function resolveSummaryRecipient(orgId: string): Promise<string | null> {
  const svc = supabaseService();
  // Per-tenant app_settings override takes precedence.
  const { data: row } = await svc
    .from("app_settings")
    .select("value")
    .eq("org_id", orgId)
    .eq("key", "summary_email_to")
    .maybeSingle();
  const fromSettings = (row?.value as any) || null;
  if (typeof fromSettings === "string" && fromSettings.includes("@")) return fromSettings;
  if (typeof fromSettings === "object" && typeof (fromSettings as any)?.email === "string") {
    return (fromSettings as any).email;
  }

  // Fall back to owner email.
  const { data: owners } = await svc
    .from("org_members")
    .select("profiles(email), created_at")
    .eq("org_id", orgId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1);
  return ((owners?.[0] as any)?.profiles?.email as string) || null;
}

export async function sendSubmissionWindowSummaryForOrg(
  orgId: string,
  slug: string,
  bucket: SummaryBucket,
  baseUrl: string,
): Promise<SummaryResult> {
  const recipientEmail = await resolveSummaryRecipient(orgId);
  if (!recipientEmail) {
    return { org_id: orgId, slug, pending_count: 0, approved_awaiting_count: 0, sent: false, reason: "no recipient email" };
  }

  const svc = supabaseService();
  const { data: pending } = await svc
    .from("receipts")
    .select("id, amount, currency, reimbursable_amount, description, status, created_at, recipients!inner(applications!inner(parent_names))")
    .eq("org_id", orgId)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(100);

  const pendingForReview = (pending || []).filter((r: any) => r.status === "pending");
  const approvedAwaiting = (pending || []).filter((r: any) => r.status === "approved");

  if (pendingForReview.length === 0 && approvedAwaiting.length === 0) {
    return { org_id: orgId, slug, pending_count: 0, approved_awaiting_count: 0, sent: false, reason: "no receipts" };
  }

  const payDateDescription = bucket === "mid"
    ? "the 15th of this month"
    : "the end of this month";

  await notifySubmissionWindowSummary({
    to: recipientEmail,
    bucket_label: bucket === "mid" ? "mid-month (15th)" : "end-of-month",
    pay_date_description: payDateDescription,
    pending_for_review: pendingForReview.map((r: any) => ({
      name:    r.recipients.applications.parent_names,
      amount:  `${r.currency || "CAD"} $${Number(r.amount).toFixed(2)}`,
      desc:    r.description || "Receipt",
    })),
    approved_awaiting_payout: approvedAwaiting.map((r: any) => ({
      name:               r.recipients.applications.parent_names,
      reimbursable_cad:   r.reimbursable_amount != null ? `$${Number(r.reimbursable_amount).toFixed(2)}` : "(needs admin amount)",
      desc:               r.description || "Receipt",
    })),
    admin_url: `${baseUrl}/o/${slug}/admin/recipients`,
    orgId,
  });

  return {
    org_id: orgId,
    slug,
    pending_count:           pendingForReview.length,
    approved_awaiting_count: approvedAwaiting.length,
    sent:                    true,
  };
}

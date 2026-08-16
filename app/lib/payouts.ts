// ============================================================
//  payouts.ts — payout-batch generation library (multi-tenant).
//
//  Used by /api/admin/payouts/generate (admin button or single-tenant cron)
//  and /api/cron/generate-payouts (iterates every active tenant).
//
//  Atomicity: paidToDate is derived from "committed" payouts so a draft
//  batch in flight is never double-counted by a concurrent call. A DB-side
//  unique partial index on (org_id, scheduled_date) WHERE status IN
//  ('draft','exported','approved') prevents two open batches for the same
//  date in the same org.
// ============================================================

import { supabaseService } from "./supabase/server";
import { calcBalance } from "./grant-calc";
import { TENANT_ACTIVE_STATUSES } from "./tenant-access";

export type PayoutBucket = "mid" | "end" | "manual";

export interface GeneratePayoutsResult {
  org_id:   string;
  batch_id?: string;
  total:    number;
  lines:    number;
  skipped?: { reason: string };
}

/** Run a payout batch for one tenant. Idempotent within a single day. */
export async function generatePayoutsForOrg(
  orgId: string,
  bucket: PayoutBucket,
): Promise<GeneratePayoutsResult> {
  // For 'end' bucket only proceed when today actually IS the last day of the
  // month — cron fires 28-31 to cover short months. Use a UTC-anchored
  // tomorrow so an admin clicking the button near UTC midnight still gets
  // the right answer (24h-add then getUTCDate was timezone-fragile).
  if (bucket === "end") {
    const now = new Date();
    const tomorrowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    if (tomorrowUTC.getUTCDate() !== 1) {
      return { org_id: orgId, total: 0, lines: 0, skipped: { reason: "not last day of month" } };
    }
  }

  const svc = supabaseService();
  const { data: recipients, error: recErr } = await svc
    .from("recipients")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "active");
  if (recErr) throw new Error(`recipients query failed: ${recErr.message}`);

  if (!recipients || recipients.length === 0) {
    return { org_id: orgId, total: 0, lines: 0, skipped: { reason: "no active recipients" } };
  }

  const today = new Date().toISOString().split("T")[0];
  const { data: batch, error: batchErr } = await svc
    .from("payout_batches")
    .insert({
      org_id:         orgId,
      scheduled_date: today,
      status:         "draft",
      total:          0,
      bucket,
    })
    .select("*")
    .single();
  if (batchErr) {
    // SQLSTATE 23505 = unique_violation. Use the code (API-stable) instead of
    // a regex on the error message (which is localized + version-dependent).
    if ((batchErr as any).code === "23505") {
      return { org_id: orgId, total: 0, lines: 0, skipped: { reason: "draft batch already exists for this date" } };
    }
    throw new Error(`payout_batches insert failed: ${batchErr.message}`);
  }

  let batchTotal = 0;
  let lines      = 0;

  for (const r of recipients) {
    const { data: receipts } = await svc
      .from("receipts")
      // currency + reimbursable_amount are REQUIRED by the math. Without
      // them every receipt silently reads as "CAD, no override", so USD gets
      // paid as though it were Canadian and an admin's explicit override is
      // ignored. Supabase types results as `any`, so the compiler cannot
      // catch a stripped select here — this list is load-bearing.
      .select("id, amount, status, currency, reimbursable_amount")
      .eq("org_id", orgId)
      .eq("recipient_id", r.id);

    const { data: payouts } = await svc
      .from("payouts")
      .select("amount, status")
      .eq("org_id", orgId)
      .eq("recipient_id", r.id);

    const committedToDate = (payouts || [])
      .filter((p: any) => p.status !== "cancelled")
      .reduce((s: number, p: any) => s + Number(p.amount), 0);
    const paidToDate = (payouts || [])
      .filter((p: any) => p.status === "paid")
      .reduce((s: number, p: any) => s + Number(p.amount), 0);

    const balance = calcBalance({
      receipts:        receipts || [],
      rate:            Number(r.reimbursement_rate),
      cap:             Number(r.approved_amount),
      paidToDate,
      committedToDate,
    });

    if (balance.eligibleForNextPayout > 0.01) {
      const includedReceiptIds = (receipts || [])
        .filter((x: any) => x.status === "approved")
        .map((x: any) => x.id);

      // Round ONCE, then use that same figure for both the row and the
      // running total, so the batch total is by construction the sum of its
      // lines. Accumulating the unrounded value let the exported CSV's TOTAL
      // disagree with the rows printed underneath it.
      const lineAmount = Number(balance.eligibleForNextPayout.toFixed(2));

      const { error: payErr } = await svc.from("payouts").insert({
        org_id:            orgId,
        batch_id:          batch.id,
        recipient_id:      r.id,
        amount:            lineAmount,
        receipts_included: includedReceiptIds,
        status:            "scheduled",
      });
      // Was discarded entirely. A failed insert dropped the family from the
      // batch while their money stayed in the total — the charity's finance
      // team would receive a CSV whose TOTAL exceeded its own line items.
      if (payErr) {
        throw new Error(`payout line for recipient ${r.id} failed: ${payErr.message}. Batch ${batch.id} is incomplete — review it before sending.`);
      }
      batchTotal += lineAmount;
      lines      += 1;
    }
  }

  const { error: totalErr } = await svc.from("payout_batches")
    .update({ total: Number(batchTotal.toFixed(2)) })
    .eq("id", batch.id);
  // Unchecked, this left batch.total at its default of 0 while real payout
  // rows existed — the export CSV then printed TOTAL 0.00 above live lines.
  if (totalErr) {
    throw new Error(`batch ${batch.id} total failed to save: ${totalErr.message}. The payout lines exist but the batch total is wrong — fix before exporting.`);
  }

  return {
    org_id:   orgId,
    batch_id: batch.id,
    total:    Number(batchTotal.toFixed(2)),
    lines,
  };
}

/**
 * Tenants eligible for cron-driven payout generation.
 *
 * Includes 'past_due' so a card-failure grace period doesn't silently stop a
 * tenant's grant program. Excludes 'paused' and 'canceled' — those tenants
 * have explicitly stopped (manual pause from /platform, or full cancellation).
 */
export async function listActiveTenants(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const svc = supabaseService();
  // Mirror the access allow-list (active/trialing/past_due/free). 'free' =
  // comped tenants — they must keep getting payouts + summaries.
  const { data } = await svc
    .from("tenants")
    .select("id, slug, name")
    .in("status", [...TENANT_ACTIVE_STATUSES]);
  return (data || []) as any[];
}

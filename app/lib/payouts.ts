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
  // month — cron fires 28-31 to cover short months.
  if (bucket === "end") {
    const today    = new Date();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    if (tomorrow.getUTCDate() !== 1) {
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
    if (/duplicate key|unique/i.test(batchErr.message)) {
      return { org_id: orgId, total: 0, lines: 0, skipped: { reason: "draft batch already exists for this date" } };
    }
    throw new Error(`payout_batches insert failed: ${batchErr.message}`);
  }

  let batchTotal = 0;
  let lines      = 0;

  for (const r of recipients) {
    const { data: receipts } = await svc
      .from("receipts")
      .select("id, amount, status")
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

      await svc.from("payouts").insert({
        org_id:            orgId,
        batch_id:          batch.id,
        recipient_id:      r.id,
        amount:            Number(balance.eligibleForNextPayout.toFixed(2)),
        receipts_included: includedReceiptIds,
        status:            "scheduled",
      });
      batchTotal += balance.eligibleForNextPayout;
      lines      += 1;
    }
  }

  await svc.from("payout_batches")
    .update({ total: Number(batchTotal.toFixed(2)) })
    .eq("id", batch.id);

  return {
    org_id:   orgId,
    batch_id: batch.id,
    total:    Number(batchTotal.toFixed(2)),
    lines,
  };
}

/** Tenants eligible for cron-driven payout generation. */
export async function listActiveTenants(): Promise<Array<{ id: string; slug: string; name: string }>> {
  const svc = supabaseService();
  const { data } = await svc
    .from("tenants")
    .select("id, slug, name")
    .in("status", ["active", "trialing", "free"]);
  return (data || []) as any[];
}

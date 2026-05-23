// ============================================================
//  Grant math — single source of truth for payout calculations.
//  Used by admin pages, portal dashboard, and cron payout-gen.
// ============================================================

import { SITE_CONFIG } from "@/app/siteConfig";
import type { Child, Receipt } from "./types";

/**
 * Default grant cap for an applicant = sum of age-tier caps
 * across all children listed. Admin can override on approval.
 */
export function defaultGrantCap(children: Child[]): number {
  return children.reduce((total, c) => {
    const tier = SITE_CONFIG.fundingCaps.find((t) => {
      const [min, max] = t.label.replace("Ages ", "").split("–").map(Number);
      return c.age >= min && c.age <= max;
    });
    return total + (tier?.cap ?? 0);
  }, 0);
}

export interface Balance {
  approvedReceiptTotal:   number;   // sum of all approved receipts (raw $)
  reimbursable:           number;   // approved receipts * rate, capped at grant cap
  paidToDate:             number;   // sum of paid payouts
  remainingCap:           number;   // cap - paidToDate
  eligibleForNextPayout:  number;   // reimbursable - paidToDate, clamped to remainingCap
}

export function calcBalance(opts: {
  receipts: Pick<Receipt, "amount" | "status">[];
  rate: number;
  cap: number;
  paidToDate: number;
}): Balance {
  const approvedReceiptTotal = opts.receipts
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.amount), 0);

  const reimbursable          = Math.min(approvedReceiptTotal * opts.rate, opts.cap);
  const remainingCap          = Math.max(0, opts.cap - opts.paidToDate);
  const eligibleForNextPayout = Math.max(0, Math.min(reimbursable - opts.paidToDate, remainingCap));

  return {
    approvedReceiptTotal,
    reimbursable,
    paidToDate: opts.paidToDate,
    remainingCap,
    eligibleForNextPayout,
  };
}

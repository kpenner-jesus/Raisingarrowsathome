// ============================================================
//  Grant math — single source of truth for payout calculations.
//
//  TERMS:
//    paidToDate      — money already paid out (status='paid'). Display.
//    committedToDate — money scheduled / approved / paid (anything not
//                      cancelled). Used in eligibility math so we never
//                      double-count a recipient who already has a draft
//                      batch line waiting to be paid out.
//
//  Used by admin pages, portal dashboard, and cron payout-gen.
// ============================================================

import { SITE_CONFIG } from "@/app/siteConfig";
import type { Child, Receipt } from "./types";

/**
 * Default grant cap for an applicant = sum of age-tier caps
 * across all children listed. Admin can override on approval.
 *
 * NOTE: SITE_CONFIG.fundingCaps ranges overlap at boundaries
 * (5–8, 8–12, 12–15, 15–18). The first matching tier wins, so an
 * 8-year-old gets the 5–8 cap, a 12-year-old gets the 8–12 cap, etc.
 * Owners confirmed this is the intended behaviour.
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
  approvedReceiptTotal:   number;
  reimbursable:           number;
  paidToDate:             number;
  committedToDate:        number;
  remainingCap:           number;
  eligibleForNextPayout:  number;
}

export function calcBalance(opts: {
  receipts: Pick<Receipt, "amount" | "status">[];
  rate: number;
  cap: number;
  paidToDate: number;
  /** Defaults to paidToDate for back-compat. Pass an explicit value when
   *  there may be scheduled/approved (not-yet-paid) payouts to count. */
  committedToDate?: number;
}): Balance {
  const committed = opts.committedToDate ?? opts.paidToDate;

  const approvedReceiptTotal = opts.receipts
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.amount), 0);

  const reimbursable          = Math.min(approvedReceiptTotal * opts.rate, opts.cap);
  const remainingCap          = Math.max(0, opts.cap - committed);
  const eligibleForNextPayout = Math.max(0, Math.min(reimbursable - committed, remainingCap));

  return {
    approvedReceiptTotal,
    reimbursable,
    paidToDate:      opts.paidToDate,
    committedToDate: committed,
    remainingCap,
    eligibleForNextPayout,
  };
}

/** Helper: sum payout amounts grouped by status filter. */
export function sumPayouts(payouts: { amount: number | string; status: string }[], statuses: string[]): number {
  return payouts
    .filter((p) => statuses.includes(p.status))
    .reduce((s, p) => s + Number(p.amount), 0);
}

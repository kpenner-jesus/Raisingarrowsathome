// ============================================================
//  Grant math — single source of truth for payout calculations.
//
//  TERMS:
//    paidToDate         — money already paid out (status='paid'). Display.
//    committedToDate    — money scheduled / approved / paid (anything not
//                         cancelled). Used in eligibility math.
//    reimbursable       — sum of admin-set `reimbursable_amount` for each
//                         approved receipt, falling back to (amount * rate)
//                         for CAD-currency approved receipts that don't have
//                         an explicit override. USD receipts that lack an
//                         override count as 0 (admin must set CAD value).
//
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
  approvedReceiptTotal:   number;   // raw $ spent (any currency, in receipt's native units)
  reimbursable:           number;   // CAD reimbursable (admin override OR amount × rate for CAD)
  paidToDate:             number;
  committedToDate:        number;
  remainingCap:           number;
  eligibleForNextPayout:  number;
}

type ReceiptLite = Pick<Receipt, "amount" | "status"> & {
  currency?:            Receipt["currency"];
  reimbursable_amount?: number | null;
};

/**
 * Compute the CAD reimbursable amount of a single approved receipt:
 *   1. If admin set reimbursable_amount → use it.
 *   2. Else if currency is CAD → amount × rate (auto).
 *   3. Else (USD without override) → 0 (admin must set explicitly).
 */
function receiptReimbursable(r: ReceiptLite, rate: number): number {
  if (r.status !== "approved") return 0;
  if (r.reimbursable_amount != null && Number.isFinite(Number(r.reimbursable_amount))) {
    return Number(r.reimbursable_amount);
  }
  const currency = r.currency ?? "CAD";
  if (currency === "CAD") {
    return Number(r.amount) * rate;
  }
  return 0;
}

export function calcBalance(opts: {
  receipts: ReceiptLite[];
  rate: number;
  cap: number;
  paidToDate: number;
  /** Defaults to paidToDate for back-compat. */
  committedToDate?: number;
}): Balance {
  const committed = opts.committedToDate ?? opts.paidToDate;

  const approvedReceiptTotal = opts.receipts
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.amount), 0);

  const reimbursableRaw = opts.receipts
    .reduce((s, r) => s + receiptReimbursable(r, opts.rate), 0);

  const reimbursable          = Math.min(reimbursableRaw, opts.cap);
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

// ── PAYOUT BUCKETS (bi-monthly schedule, with 2-week submission cutoffs) ──────
//
// Pay date     Submission cutoff (≥2 wks prior)
// 15th         1st of same month
// last-day     17th of same month
//
// Receipts submitted between cutoff and pay date roll to the next bucket.

export interface BucketTimes {
  pay_date: Date;
  submission_cutoff: Date;
  label: string;          // 'mid' or 'end'
}

/** Last day of the month for any given date. */
export function lastDayOfMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Today's bucket assignment given current date. */
export function currentBucket(today = new Date()): BucketTimes {
  const day = today.getDate();
  const month = today.getMonth();
  const year = today.getFullYear();
  const lastDay = lastDayOfMonth(today);

  // After mid-cutoff (1st) and before mid-pay (15th) → next is "mid" of this month
  if (day <= 1) {
    return {
      pay_date: new Date(year, month, 15),
      submission_cutoff: new Date(year, month, 1),
      label: "mid",
    };
  }
  // After mid-pay (15th) and before end-cutoff (17th) → next is "end" of this month
  if (day <= 17) {
    return {
      pay_date: new Date(year, month, lastDay),
      submission_cutoff: new Date(year, month, 17),
      label: "end",
    };
  }
  // After end-cutoff (17th) → next is "mid" of next month
  return {
    pay_date: new Date(year, month + 1, 15),
    submission_cutoff: new Date(year, month + 1, 1),
    label: "mid",
  };
}

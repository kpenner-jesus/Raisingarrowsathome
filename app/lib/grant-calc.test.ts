// ============================================================
//  grant-calc.test.ts — payout math sanity checks
//
//  These are the highest-value tests in the codebase: errors here
//  translate directly into real-money mistakes for grant families.
//  Add a test before fixing any payout bug.
// ============================================================

import { describe, it, expect } from "vitest";
import { calcBalance, currentBucket, lastDayOfMonth, defaultGrantCap } from "./grant-calc";


/**
 * Build a complete receipt. Both currency and reimbursable_amount are
 * required by the math, and the bug this suite missed was a CALLER that
 * omitted them — so tests must never construct partial receipts either.
 */
function rcpt(o: {
  amount: number;
  status: "approved" | "pending" | "rejected";
  currency?: "CAD" | "USD" | null;
  reimbursable_amount?: number | null;
}) {
  return {
    amount: o.amount,
    status: o.status,
    currency: o.currency ?? "CAD",
    reimbursable_amount: o.reimbursable_amount ?? null,
  } as const;
}

describe("calcBalance", () => {
  const baseOpts = { rate: 0.75, cap: 1000, paidToDate: 0 };

  it("returns zeros when there are no receipts", () => {
    const r = calcBalance({ ...baseOpts, receipts: [] });
    expect(r.approvedReceiptTotal).toBe(0);
    expect(r.reimbursable).toBe(0);
    expect(r.eligibleForNextPayout).toBe(0);
    expect(r.remainingCap).toBe(1000);
  });

  it("ignores non-approved receipts", () => {
    const r = calcBalance({
      ...baseOpts,
      receipts: [
        rcpt({ amount: 100, status: "pending" }),
        rcpt({ amount: 100, status: "rejected" }),
        rcpt({ amount: 100, status: "approved" }),
      ],
    });
    expect(r.approvedReceiptTotal).toBe(100);
    expect(r.reimbursable).toBe(75); // 100 * 0.75
  });

  it("uses admin reimbursable_amount override when set", () => {
    const r = calcBalance({
      ...baseOpts,
      receipts: [
        rcpt({ amount: 100, status: "approved", reimbursable_amount: 60 }),
      ],
    });
    // override wins over the 75% auto-calc
    expect(r.reimbursable).toBe(60);
  });

  it("counts USD receipts as 0 without an explicit CAD override", () => {
    const r = calcBalance({
      ...baseOpts,
      receipts: [
        rcpt({ amount: 200, status: "approved", currency: "USD" }),
      ],
    });
    expect(r.reimbursable).toBe(0);
  });

  it("uses override on USD receipts when admin set it", () => {
    const r = calcBalance({
      ...baseOpts,
      receipts: [
        rcpt({ amount: 200, status: "approved", currency: "USD", reimbursable_amount: 220 }),
      ],
    });
    expect(r.reimbursable).toBe(220);
  });

  it("caps reimbursable at the grant cap", () => {
    const r = calcBalance({
      ...baseOpts,
      cap: 100,
      receipts: [
        rcpt({ amount: 1000, status: "approved", currency: "CAD" }),
      ],
    });
    // 1000 * 0.75 = 750 but cap=100
    expect(r.reimbursable).toBe(100);
  });

  it("eligibleForNextPayout subtracts already-committed dollars", () => {
    const r = calcBalance({
      ...baseOpts,
      paidToDate:       200,
      committedToDate:  300,  // includes a $100 scheduled payout
      receipts: [
        rcpt({ amount: 1000, status: "approved", currency: "CAD" }), // 750 reimbursable
      ],
    });
    // reimbursable=750, committed=300 → next bucket = 450
    expect(r.eligibleForNextPayout).toBe(450);
    expect(r.remainingCap).toBe(700);
  });

  it("never goes negative on eligibleForNextPayout when committed exceeds reimbursable", () => {
    const r = calcBalance({
      ...baseOpts,
      paidToDate:      500,
      committedToDate: 500,
      receipts: [
        rcpt({ amount: 200, status: "approved" }), // 150 reimbursable
      ],
    });
    expect(r.eligibleForNextPayout).toBe(0);
    expect(r.remainingCap).toBe(500);
  });

  it("falls back to paidToDate when committedToDate isn't provided", () => {
    const r = calcBalance({
      ...baseOpts,
      paidToDate: 250,
      receipts:   [rcpt({ amount: 400, status: "approved" })], // 300 reimbursable
    });
    expect(r.committedToDate).toBe(250);
    expect(r.eligibleForNextPayout).toBe(50);
  });

  it("remainingCap honours the cap even when paidToDate exceeds it (e.g. overpaid)", () => {
    const r = calcBalance({
      ...baseOpts,
      cap:        100,
      paidToDate: 200, // somehow overpaid
      receipts:   [],
    });
    expect(r.remainingCap).toBe(0);
  });
});

describe("lastDayOfMonth", () => {
  it("returns 31 for Jan", () => {
    expect(lastDayOfMonth(new Date(2026, 0, 1))).toBe(31);
  });
  it("returns 28 for non-leap Feb", () => {
    expect(lastDayOfMonth(new Date(2026, 1, 1))).toBe(28);
  });
  it("returns 29 for leap Feb (2024)", () => {
    expect(lastDayOfMonth(new Date(2024, 1, 1))).toBe(29);
  });
  it("returns 30 for April", () => {
    expect(lastDayOfMonth(new Date(2026, 3, 1))).toBe(30);
  });
});

describe("currentBucket", () => {
  it("on the 1st of the month → next bucket is mid-month (15th)", () => {
    const b = currentBucket(new Date(2026, 4, 1)); // May 1
    expect(b.label).toBe("mid");
    expect(b.pay_date.getDate()).toBe(15);
    expect(b.pay_date.getMonth()).toBe(4);
  });

  it("on the 10th → next bucket is end-of-month (mid cutoff was day 1)", () => {
    // Submission cutoff for the 15th payout is the 1st. After the 1st,
    // new receipts roll into the end-of-month payout (cutoff 17th).
    const b = currentBucket(new Date(2026, 4, 10));
    expect(b.label).toBe("end");
    expect(b.pay_date.getDate()).toBe(31);
  });

  it("on the 16th (between mid-pay and end-cutoff) → next is end-of-month", () => {
    const b = currentBucket(new Date(2026, 4, 16));
    expect(b.label).toBe("end");
    expect(b.pay_date.getDate()).toBe(31); // May has 31
  });

  it("on the 17th (= end-cutoff itself) → still end-of-month", () => {
    const b = currentBucket(new Date(2026, 4, 17));
    expect(b.label).toBe("end");
  });

  it("on the 18th → next is mid of NEXT month", () => {
    const b = currentBucket(new Date(2026, 4, 18));
    expect(b.label).toBe("mid");
    expect(b.pay_date.getMonth()).toBe(5); // June
    expect(b.pay_date.getDate()).toBe(15);
  });

  it("handles December rollover into January", () => {
    const b = currentBucket(new Date(2026, 11, 25)); // Dec 25
    expect(b.label).toBe("mid");
    expect(b.pay_date.getMonth()).toBe(0); // Jan
    expect(b.pay_date.getFullYear()).toBe(2027);
  });
});

describe("defaultGrantCap", () => {
  it("returns 0 for no children", () => {
    expect(defaultGrantCap([])).toBe(0);
  });

  it("sums tier caps across multiple children", () => {
    // Ages 5-8 = $375, 8-12 = $500, 12-15 = $650, 15-18 = $750
    // (per app/siteConfig.ts)
    const total = defaultGrantCap([
      { name: "A", age: 7  } as any,  // 5-8 tier
      { name: "B", age: 10 } as any,  // 8-12 tier
    ]);
    expect(total).toBe(375 + 500);
  });

  it("treats ages outside known tiers as 0", () => {
    const total = defaultGrantCap([
      { name: "Baby",   age: 2  } as any,  // below smallest tier
      { name: "Senior", age: 19 } as any,  // above largest tier
    ]);
    expect(total).toBe(0);
  });
});

// ============================================================
//  Regression: the stripped-select bug.
//
//  app/lib/payouts.ts selected only "id, amount, status", so currency and
//  reimbursable_amount arrived as undefined. `undefined != null` is FALSE
//  in JavaScript, so the override check fell through, and
//  `undefined ?? "CAD"` then made every receipt look Canadian.
//
//  These lock in what SHOULD happen for each shape so the behaviour can't
//  quietly change again.
// ============================================================
describe("currency + override handling (the stripped-select bug)", () => {
  const opts = { rate: 0.75, cap: 100_000, paidToDate: 0, committedToDate: 0 };

  it("a USD receipt with no override is worth ZERO, not amount x rate", () => {
    const r = calcBalance({ ...opts, receipts: [rcpt({ amount: 500, status: "approved", currency: "USD" })] });
    // the bug paid 500 * 0.75 = 375 CAD for 500 US dollars
    expect(r.reimbursable).toBe(0);
  });

  it("an explicit $0 override is honoured, not overwritten by the auto-calc", () => {
    // An admin setting 0 means "this item does not qualify". The bug ignored
    // it and paid 1000 * 0.75 = 750.
    const r = calcBalance({ ...opts, receipts: [rcpt({ amount: 1000, status: "approved", reimbursable_amount: 0 })] });
    expect(r.reimbursable).toBe(0);
  });

  it("an override above the auto-calc is honoured", () => {
    const r = calcBalance({ ...opts, receipts: [rcpt({ amount: 200, status: "approved", currency: "USD", reimbursable_amount: 250 })] });
    expect(r.reimbursable).toBe(250);
  });

  it("null currency is treated as CAD (the column is nullable)", () => {
    const r = calcBalance({ ...opts, receipts: [rcpt({ amount: 100, status: "approved", currency: null })] });
    expect(r.reimbursable).toBe(75);
  });

  it("a mixed batch totals correctly", () => {
    const r = calcBalance({ ...opts, receipts: [
      rcpt({ amount: 100, status: "approved" }),                                        // 75
      rcpt({ amount: 500, status: "approved", currency: "USD" }),                        // 0
      rcpt({ amount: 200, status: "approved", reimbursable_amount: 50 }),                // 50
      rcpt({ amount: 999, status: "pending" }),                                          // 0
    ]});
    expect(r.reimbursable).toBe(125);
  });
});

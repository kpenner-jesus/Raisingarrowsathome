import { describe, it, expect } from "vitest";
import {
  normalizeEmail, buildLedgerRows, classifyResendOutcome,
  idempotencyKey, unsubExpiryFor, shouldStopSlice, deriveBroadcastStatus,
} from "./broadcast-logic";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Family@Example.COM ")).toBe("family@example.com");
  });
  it("rejects anything unusable", () => {
    for (const bad of ["", "   ", null, undefined, "nope", "@x.com", "a@", "a b@c.com"]) {
      expect(normalizeEmail(bad as any), String(bad)).toBe(null);
    }
  });
});

describe("buildLedgerRows", () => {
  it("dedupes the same address in different cases", () => {
    // recipients is unique on application_id, NOT on email — two applications
    // sharing a contact address used to get two copies of every broadcast.
    const rows = buildLedgerRows({
      rows: [
        { email: "A@x.com", parent_names: "Adams" },
        { email: "a@x.com", parent_names: "Adams (2nd application)" },
      ],
      optedOut: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].parent_names).toBe("Adams");
  });

  it("drops opt-outs regardless of case", () => {
    const rows = buildLedgerRows({
      rows: [{ email: "keep@x.com" }, { email: "Gone@X.com" }],
      optedOut: ["gone@x.com"],
    });
    expect(rows.map((r) => r.email)).toEqual(["keep@x.com"]);
  });

  it("drops invalid addresses instead of trying to mail them", () => {
    const rows = buildLedgerRows({ rows: [{ email: null }, { email: "" }, { email: "nope" }, { email: "ok@x.com" }], optedOut: [] });
    expect(rows.map((r) => r.email)).toEqual(["ok@x.com"]);
  });

  it("falls back to a usable greeting when the name is blank", () => {
    expect(buildLedgerRows({ rows: [{ email: "a@x.com", parent_names: "  " }], optedOut: [] })[0].parent_names).toBe("friend");
  });

  it("is deterministically ordered", () => {
    const input = { rows: [{ email: "c@x.com" }, { email: "a@x.com" }, { email: "b@x.com" }], optedOut: [] };
    expect(buildLedgerRows(input).map((r) => r.email)).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});

describe("classifyResendOutcome", () => {
  it("treats 2xx as sent", () => {
    expect(classifyResendOutcome({ status: 200 }).outcome).toBe("sent");
    expect(classifyResendOutcome({ status: 201 }).outcome).toBe("sent");
  });

  // The one that was silently losing mail: 429 was recorded as a permanent
  // failure, so rate-limited families were written off as undeliverable.
  it("treats rate limiting as RETRYABLE, not failed", () => {
    const r = classifyResendOutcome({ status: 429, retryAfterHeader: "3" });
    expect(r.outcome).toBe("retryable");
    expect((r as any).retryAfterMs).toBe(3000);
  });
  it("handles a 429 with no Retry-After", () => {
    const r = classifyResendOutcome({ status: 429 });
    expect(r.outcome).toBe("retryable");
    expect((r as any).retryAfterMs).toBeUndefined();
  });

  it("treats 5xx as retryable and other 4xx as permanent", () => {
    expect(classifyResendOutcome({ status: 500 }).outcome).toBe("retryable");
    expect(classifyResendOutcome({ status: 422, bodyText: "bad address" }).outcome).toBe("permanent");
  });

  it("flags an auth failure so the run can abort instead of burning every row", () => {
    const r = classifyResendOutcome({ status: 401 });
    expect(r.outcome).toBe("permanent");
    expect((r as any).alert).toBe(true);
  });
});

describe("idempotencyKey", () => {
  it("stays within the provider's 256-character header limit", () => {
    const monster = "a".repeat(300) + "@example.com";
    expect(idempotencyKey("11111111-1111-1111-1111-111111111111", monster).length).toBeLessThanOrEqual(256);
  });
  it("is stable for the same broadcast + recipient", () => {
    const a = idempotencyKey("b1", "family@x.com");
    expect(idempotencyKey("b1", "FAMILY@x.com")).toBe(a);
  });
  it("differs across recipients and across broadcasts", () => {
    expect(idempotencyKey("b1", "a@x.com")).not.toBe(idempotencyKey("b1", "b@x.com"));
    expect(idempotencyKey("b1", "a@x.com")).not.toBe(idempotencyKey("b2", "a@x.com"));
  });
});

describe("unsubExpiryFor", () => {
  // This is what makes the idempotency key work at all: the payload has to be
  // byte-identical across retries, and the old token embedded Date.now().
  it("is derived from the broadcast, so a retry renders identical html", () => {
    const created = "2026-08-01T00:00:00.000Z";
    expect(unsubExpiryFor(created, 1)).toBe(unsubExpiryFor(created, 999_999_999));
  });
  it("falls back to now when created_at is missing", () => {
    expect(unsubExpiryFor(null, 1_000_000_000_000)).toBe(1_000_000_000 + 31_536_000);
  });
});

describe("shouldStopSlice", () => {
  it("stops on the time budget with work left", () => {
    expect(shouldStopSlice({ elapsedMs: 21_000, budgetMs: 20_000, pending: 50 })).toBe("stop_budget");
  });
  it("keeps going inside the budget", () => {
    expect(shouldStopSlice({ elapsedMs: 1_000, budgetMs: 20_000, pending: 50 })).toBe("send");
  });
  it("reports done when nothing is pending", () => {
    expect(shouldStopSlice({ elapsedMs: 1_000, budgetMs: 20_000, pending: 0 })).toBe("done");
  });
});

describe("deriveBroadcastStatus", () => {
  const now = Date.UTC(2026, 7, 17, 12, 0, 0);
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const base = { nowMs: now, sent: 0, failed: 0, pending: 0 };

  it("scheduled for the future", () => {
    const s = deriveBroadcastStatus({ ...base, state: "queued", scheduled_for: new Date(now + 3600_000).toISOString(), total: 10, pending: 10 });
    expect(s.label).toBe("Scheduled");
    expect(s.canResume).toBe(false);
  });

  it("actively sending — Resume must NOT be offered", () => {
    const s = deriveBroadcastStatus({ ...base, state: "sending", materialized_at: iso(60_000), progress_at: iso(5_000), total: 100, sent: 40, pending: 60 });
    expect(s.label).toBe("Sending");
    expect(s.canResume).toBe(false);
    expect(s.percent).toBe(40);
  });

  it("stalled mid-send — Resume IS offered", () => {
    const s = deriveBroadcastStatus({ ...base, state: "sending", materialized_at: iso(3600_000), progress_at: iso(20 * 60_000), total: 100, sent: 40, pending: 60 });
    expect(s.label).toBe("Paused");
    expect(s.canResume).toBe(true);
  });

  it("still building the recipient list", () => {
    const s = deriveBroadcastStatus({ ...base, state: "sending", materialized_at: null, progress_at: iso(2_000), total: null, pending: 0 });
    expect(s.label).toBe("Preparing");
  });

  // The invariant that protects families from a duplicate mailing.
  it("a pre-ledger broadcast can NEVER be resumed", () => {
    const stranded = deriveBroadcastStatus({ ...base, state: "sending", total: null, progress_at: null });
    expect(stranded.canResume).toBe(false);
    expect(stranded.isLegacy).toBe(true);
    const old = deriveBroadcastStatus({ ...base, state: "sent", total: null, sent: 0 });
    expect(old.label).toBe("Sent");
    expect(old.canResume).toBe(false);
  });

  it("marked sent but rows still pending is Incomplete, not Sent", () => {
    const s = deriveBroadcastStatus({ ...base, state: "sent", total: 100, sent: 90, pending: 10 });
    expect(s.label).toBe("Incomplete");
    expect(s.canResume).toBe(true);
  });

  it("sent with some failures offers Retry failed but not Resume", () => {
    const s = deriveBroadcastStatus({ ...base, state: "sent", total: 100, sent: 97, failed: 3, pending: 0 });
    expect(s.label).toBe("Sent, some failed");
    expect(s.canResume).toBe(false);
    expect(s.canRetryFailed).toBe(true);
  });

  it("a clean send is just Sent", () => {
    const s = deriveBroadcastStatus({ ...base, state: "sent", total: 50, sent: 50 });
    expect(s.label).toBe("Sent");
    expect(s.percent).toBe(100);
    expect(s.canRetryFailed).toBe(false);
  });
});

describe("network failures", () => {
  it("a request that never completed is retryable, not a permanent failure", () => {
    // Otherwise a blip mid-broadcast writes families off as undeliverable.
    expect(classifyResendOutcome({ status: 0, bodyText: "fetch failed" }).outcome).toBe("retryable");
  });
});

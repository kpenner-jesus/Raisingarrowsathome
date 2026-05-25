import { describe, it, expect } from "vitest";
import { decideReminder } from "./billing-reminder-logic";

function trialInDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe("decideReminder — trial windows", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("fires trial_3day when trial ends in 3 days, never fired before", () => {
    const r = decideReminder({
      status: "trialing",
      trial_ends_at: trialInDays(now, 3),
      last_reminder_kind: null,
      last_reminder_sent_at: null,
      now,
    });
    expect(r.fire).toBe("trial_3day");
    if (r.fire === "trial_3day") expect(r.daysLeftCopy).toBe(3);
  });

  it("does not re-fire trial_3day on day 2 (already sent)", () => {
    const r = decideReminder({
      status: "trialing",
      trial_ends_at: trialInDays(now, 2),
      last_reminder_kind: "trial_3day",
      last_reminder_sent_at: trialInDays(now, -1),
      now,
    });
    expect(r.fire).toBe(null);
  });

  it("fires trial_1day at days=1", () => {
    const r = decideReminder({
      status: "trialing",
      trial_ends_at: trialInDays(now, 1),
      last_reminder_kind: "trial_3day",
      last_reminder_sent_at: trialInDays(now, -2),
      now,
    });
    expect(r.fire).toBe("trial_1day");
    if (r.fire === "trial_1day") expect(r.daysLeftCopy).toBe(1);
  });

  it("does not re-fire trial_1day next day (state machine)", () => {
    const r = decideReminder({
      status: "trialing",
      trial_ends_at: trialInDays(now, 0),
      last_reminder_kind: "trial_1day",
      last_reminder_sent_at: trialInDays(now, -1),
      now,
    });
    expect(r.fire).toBe(null);
  });

  it("trial_1day copy says 'today' (daysLeftCopy=0) when within 0.5 days", () => {
    const r = decideReminder({
      status: "trialing",
      trial_ends_at: trialInDays(now, 0.3),
      last_reminder_kind: null,
      last_reminder_sent_at: null,
      now,
    });
    expect(r.fire).toBe("trial_1day");
    if (r.fire === "trial_1day") expect(r.daysLeftCopy).toBe(0);
  });

  it("does not fire after trial expired by more than 0.5 day", () => {
    const r = decideReminder({
      status: "trialing",
      trial_ends_at: trialInDays(now, -1),
      last_reminder_kind: null,
      last_reminder_sent_at: null,
      now,
    });
    expect(r.fire).toBe(null);
  });

  it("does not fire if not trialing", () => {
    const r = decideReminder({
      status: "active",
      trial_ends_at: trialInDays(now, 2),
      last_reminder_kind: null,
      last_reminder_sent_at: null,
      now,
    });
    expect(r.fire).toBe(null);
  });
});

describe("decideReminder — past_due", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("fires past_due first time", () => {
    const r = decideReminder({
      status: "past_due",
      trial_ends_at: null,
      last_reminder_kind: null,
      last_reminder_sent_at: null,
      now,
    });
    expect(r.fire).toBe("past_due");
  });

  it("does not re-fire past_due within 6 days", () => {
    const r = decideReminder({
      status: "past_due",
      trial_ends_at: null,
      last_reminder_kind: "past_due",
      last_reminder_sent_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      now,
    });
    expect(r.fire).toBe(null);
  });

  it("re-fires past_due after 7 days", () => {
    const r = decideReminder({
      status: "past_due",
      trial_ends_at: null,
      last_reminder_kind: "past_due",
      last_reminder_sent_at: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      now,
    });
    expect(r.fire).toBe("past_due");
  });
});

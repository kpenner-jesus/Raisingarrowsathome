// Pure-function billing-reminder state machine.
// Extracted from billing-reminders.ts so unit tests can validate the
// window logic without touching Supabase.

export type ReminderKind = "trial_3day" | "trial_1day" | "past_due";

export interface ReminderInput {
  status:                 string;
  trial_ends_at:          string | null;
  last_reminder_kind:     ReminderKind | null;
  last_reminder_sent_at:  string | null;
  now:                    Date;
}

export type ReminderDecision =
  | { fire: ReminderKind; daysLeftCopy: number }
  | { fire: null; reason: string };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function decideReminder(input: ReminderInput): ReminderDecision {
  const nowMs = input.now.getTime();

  if (input.status === "trialing" && input.trial_ends_at) {
    const endsMs   = new Date(input.trial_ends_at).getTime();
    const daysLeft = (endsMs - nowMs) / ONE_DAY_MS;
    const lastKind = input.last_reminder_kind;

    if (
      daysLeft >= 1.5 && daysLeft <= 4.0 &&
      lastKind !== "trial_3day" && lastKind !== "trial_1day"
    ) {
      return { fire: "trial_3day", daysLeftCopy: Math.max(1, Math.round(daysLeft)) };
    }

    if (
      daysLeft >= -0.5 && daysLeft < 1.5 &&
      lastKind !== "trial_1day"
    ) {
      return { fire: "trial_1day", daysLeftCopy: daysLeft >= 0.5 ? 1 : 0 };
    }

    return { fire: null, reason: "outside any trial window or already sent" };
  }

  if (input.status === "past_due") {
    const lastSentMs = input.last_reminder_sent_at ? new Date(input.last_reminder_sent_at).getTime() : 0;
    const recentlySent = (input.last_reminder_kind === "past_due") &&
      (nowMs - lastSentMs) < 6 * ONE_DAY_MS;
    if (recentlySent) return { fire: null, reason: "past_due nudge sent within 6 days" };
    return { fire: "past_due", daysLeftCopy: 0 };
  }

  return { fire: null, reason: `status=${input.status} — no reminder` };
}

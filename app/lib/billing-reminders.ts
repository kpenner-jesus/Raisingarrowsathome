// ============================================================
//  billing-reminders.ts — runs from the daily cron dispatch.
//  Sends three platform-level emails based on subscription state:
//
//    - "trial ends in N days" when trial_ends_at is 1.5–4 days out
//    - "trial ends soon"      when trial_ends_at is -0.5–1.5 days out
//    - "payment failed"       when status='past_due' (weekly nudge)
//
//  Idempotency: tenants.last_reminder_kind + tenants.last_reminder_sent_at
//  track which reminder we last sent so the daily cron can't fire the same
//  email twice. State machine:
//
//    null → trial_3day → trial_1day → (paid → null) | (past_due → past_due)
//
//  past_due re-fires once per 6+ days. When status flips off past_due the
//  webhook clears last_reminder_kind so the cycle can restart.
// ============================================================

import { supabaseService } from "./supabase/server";
import { sendTrialEndingSoon, sendPastDueNudge } from "./notify-platform";
import { decideReminder, type ReminderKind } from "./billing-reminder-logic";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Owner email + billing URL for a tenant. Multi-owner safe: picks first by created_at. */
async function ownerEmail(orgId: string, slug: string): Promise<{ email: string | null; billingUrl: string }> {
  const svc = supabaseService();
  // Use .limit(1) + .order(...) instead of .maybeSingle() so multi-owner orgs
  // don't silently return null and lose all their billing emails.
  const { data: owners } = await svc
    .from("org_members")
    .select("user_id, created_at, profiles(email)")
    .eq("org_id", orgId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1);
  const first = owners?.[0] as any;
  const email = first?.profiles?.email || null;
  const baseUrl = process.env.NEXT_PUBLIC_PLATFORM_URL || "https://raisingarrowsathome.com";
  const billingUrl = `${baseUrl}/o/${slug}/admin/settings/billing`;
  return { email, billingUrl };
}

export interface ReminderResult {
  org_id: string;
  slug:   string;
  kind:   ReminderKind;
  sent:   boolean;
  reason?: string;
}

/** Persist that we sent a reminder so we don't fire it again. */
async function markSent(orgId: string, kind: ReminderKind, now: Date) {
  const svc = supabaseService();
  await svc.from("tenants").update({
    last_reminder_kind:    kind,
    last_reminder_sent_at: now.toISOString(),
  }).eq("id", orgId);
}

/**
 * Scan tenants and send any reminders due. Designed to be called from
 * the daily cron dispatch. Returns one row per tenant we touched so the
 * cron log shows what happened.
 */
export async function processBillingReminders(now: Date = new Date()): Promise<ReminderResult[]> {
  const svc = supabaseService();
  const { data: tenants } = await svc
    .from("tenants")
    .select("id, slug, name, status, trial_ends_at, last_reminder_kind, last_reminder_sent_at");

  if (!tenants) return [];

  const results: ReminderResult[] = [];

  for (const t of tenants as any[]) {
    // Decide which reminder (if any) should fire — pure function, unit-tested.
    const decision = decideReminder({
      status: t.status,
      trial_ends_at: t.trial_ends_at,
      last_reminder_kind: t.last_reminder_kind,
      last_reminder_sent_at: t.last_reminder_sent_at,
      now,
    });
    if (!decision.fire) continue;

    const { email, billingUrl } = await ownerEmail(t.id, t.slug);
    if (!email) {
      results.push({ org_id: t.id, slug: t.slug, kind: decision.fire, sent: false, reason: "no owner email" });
      continue;
    }

    try {
      if (decision.fire === "past_due") {
        await sendPastDueNudge({ to: email, orgName: t.name, billingUrl });
      } else {
        await sendTrialEndingSoon({
          to: email,
          orgName: t.name,
          daysLeft: decision.daysLeftCopy,
          billingUrl,
        });
      }
      await markSent(t.id, decision.fire, now);
      results.push({ org_id: t.id, slug: t.slug, kind: decision.fire, sent: true });
    } catch (e: any) {
      results.push({ org_id: t.id, slug: t.slug, kind: decision.fire, sent: false, reason: e?.message || "send failed" });
    }
  }

  return results;
}

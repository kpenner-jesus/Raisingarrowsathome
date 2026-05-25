// ============================================================
//  billing-reminders.ts — runs from the daily cron dispatch.
//  Sends three platform-level emails based on subscription state:
//
//    - "3 days left in trial"   when trial_ends_at is 3 days out
//    - "trial ends tomorrow"    when trial_ends_at is ~1 day out
//    - "payment failed"         when status='past_due' (weekly nudge)
//
//  Dedupe is best-effort: the cron fires once per UTC day, so each
//  tenant hits each window exactly once. If the cron runs twice in
//  a day (manual trigger + scheduled), a tenant may receive a
//  duplicate. We accept this — duplicate billing reminders are
//  annoying but not damaging.
// ============================================================

import { supabaseService } from "./supabase/server";
import { sendTrialEndingSoon, sendPastDueNudge } from "./notify-platform";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Owner email + admin URL for a tenant. */
async function ownerEmail(orgId: string, slug: string): Promise<{ email: string | null; billingUrl: string }> {
  const svc = supabaseService();
  const { data: owner } = await svc
    .from("org_members")
    .select("user_id, profiles(email)")
    .eq("org_id", orgId)
    .eq("role", "owner")
    .maybeSingle();
  const email = (owner as any)?.profiles?.email || null;
  // Public origin isn't known here — use the canonical production hostname.
  // Tenants on custom domains will still receive a working URL because
  // /o/<slug>/admin redirects host-aware.
  const baseUrl = process.env.NEXT_PUBLIC_PLATFORM_URL || "https://raisingarrowsathome.com";
  const billingUrl = `${baseUrl}/o/${slug}/admin/settings/billing`;
  return { email, billingUrl };
}

export interface ReminderResult {
  org_id: string;
  slug:   string;
  kind:   "trial_3day" | "trial_1day" | "past_due";
  sent:   boolean;
  reason?: string;
}

/**
 * Scan tenants and send any reminders due. Designed to be called from
 * the daily cron dispatch. Returns one row per tenant we touched (sent
 * or skipped) so the cron log shows what happened.
 */
export async function processBillingReminders(now: Date = new Date()): Promise<ReminderResult[]> {
  const svc = supabaseService();
  const { data: tenants } = await svc
    .from("tenants")
    .select("id, slug, name, status, trial_ends_at");

  if (!tenants) return [];

  const results: ReminderResult[] = [];
  const nowMs = now.getTime();

  for (const t of tenants as any[]) {
    // ── Trial reminders (status='trialing' AND we have an expiry) ──
    if (t.status === "trialing" && t.trial_ends_at) {
      const endsMs = new Date(t.trial_ends_at).getTime();
      const daysLeft = (endsMs - nowMs) / ONE_DAY_MS;

      // 3-day window: 2.5 <= days_left < 3.5
      if (daysLeft >= 2.5 && daysLeft < 3.5) {
        const { email, billingUrl } = await ownerEmail(t.id, t.slug);
        if (email) {
          await sendTrialEndingSoon({ to: email, orgName: t.name, daysLeft: 3, billingUrl });
          results.push({ org_id: t.id, slug: t.slug, kind: "trial_3day", sent: true });
        } else {
          results.push({ org_id: t.id, slug: t.slug, kind: "trial_3day", sent: false, reason: "no owner email" });
        }
        continue;
      }

      // 1-day window: -0.5 <= days_left < 1.5 (covers "tomorrow" + "today")
      if (daysLeft >= -0.5 && daysLeft < 1.5) {
        const { email, billingUrl } = await ownerEmail(t.id, t.slug);
        if (email) {
          await sendTrialEndingSoon({ to: email, orgName: t.name, daysLeft: Math.max(1, Math.ceil(daysLeft)), billingUrl });
          results.push({ org_id: t.id, slug: t.slug, kind: "trial_1day", sent: true });
        } else {
          results.push({ org_id: t.id, slug: t.slug, kind: "trial_1day", sent: false, reason: "no owner email" });
        }
        continue;
      }
    }

    // ── Past-due nudge (weekly) ──
    // We send once per week. Without a dedicated 'last sent' column we
    // approximate: send on UTC day-of-week === 1 (Monday). Tenants that
    // remain past_due will get nudged each Monday until billing resumes.
    if (t.status === "past_due" && now.getUTCDay() === 1) {
      const { email, billingUrl } = await ownerEmail(t.id, t.slug);
      if (email) {
        await sendPastDueNudge({ to: email, orgName: t.name, billingUrl });
        results.push({ org_id: t.id, slug: t.slug, kind: "past_due", sent: true });
      } else {
        results.push({ org_id: t.id, slug: t.slug, kind: "past_due", sent: false, reason: "no owner email" });
      }
    }
  }

  return results;
}

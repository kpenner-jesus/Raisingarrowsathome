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
  kind:   "trial_3day" | "trial_1day" | "past_due";
  sent:   boolean;
  reason?: string;
}

type ReminderKind = "trial_3day" | "trial_1day" | "past_due";

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
  const nowMs = now.getTime();

  for (const t of tenants as any[]) {
    // ── Trial reminders ──
    if (t.status === "trialing" && t.trial_ends_at) {
      const endsMs   = new Date(t.trial_ends_at).getTime();
      const daysLeft = (endsMs - nowMs) / ONE_DAY_MS;
      const lastKind = t.last_reminder_kind as ReminderKind | null;

      // trial_3day fires once when daysLeft falls in [1.5, 4.0]. State machine
      // gate prevents re-fire after we've already sent it.
      if (
        daysLeft >= 1.5 && daysLeft <= 4.0 &&
        lastKind !== "trial_3day" && lastKind !== "trial_1day"
      ) {
        const { email, billingUrl } = await ownerEmail(t.id, t.slug);
        if (email) {
          try {
            await sendTrialEndingSoon({ to: email, orgName: t.name, daysLeft: Math.max(1, Math.round(daysLeft)), billingUrl });
            await markSent(t.id, "trial_3day", now);
            results.push({ org_id: t.id, slug: t.slug, kind: "trial_3day", sent: true });
          } catch (e: any) {
            results.push({ org_id: t.id, slug: t.slug, kind: "trial_3day", sent: false, reason: e?.message || "send failed" });
          }
        } else {
          results.push({ org_id: t.id, slug: t.slug, kind: "trial_3day", sent: false, reason: "no owner email" });
        }
        continue;
      }

      // trial_1day fires once when daysLeft falls in [-0.5, 1.5). Even after
      // trial_3day has fired we still want this last-chance nudge.
      if (
        daysLeft >= -0.5 && daysLeft < 1.5 &&
        lastKind !== "trial_1day"
      ) {
        const { email, billingUrl } = await ownerEmail(t.id, t.slug);
        if (email) {
          // Pre-expiry: daysLeft >= 0.5 → "1 day"; near zero → "today".
          const copy = daysLeft >= 0.5 ? 1 : 0;
          try {
            await sendTrialEndingSoon({ to: email, orgName: t.name, daysLeft: copy, billingUrl });
            await markSent(t.id, "trial_1day", now);
            results.push({ org_id: t.id, slug: t.slug, kind: "trial_1day", sent: true });
          } catch (e: any) {
            results.push({ org_id: t.id, slug: t.slug, kind: "trial_1day", sent: false, reason: e?.message || "send failed" });
          }
        } else {
          results.push({ org_id: t.id, slug: t.slug, kind: "trial_1day", sent: false, reason: "no owner email" });
        }
        continue;
      }
    }

    // ── Past-due nudge ──
    // Re-fires once per 6+ days while status stays past_due. Webhook clears
    // last_reminder_kind when status flips back to active, so the next
    // past_due event will fire the first nudge immediately.
    if (t.status === "past_due") {
      const lastSentMs = t.last_reminder_sent_at ? new Date(t.last_reminder_sent_at).getTime() : 0;
      const recentlySent = (t.last_reminder_kind === "past_due") &&
        (nowMs - lastSentMs) < 6 * ONE_DAY_MS;
      if (!recentlySent) {
        const { email, billingUrl } = await ownerEmail(t.id, t.slug);
        if (email) {
          try {
            await sendPastDueNudge({ to: email, orgName: t.name, billingUrl });
            await markSent(t.id, "past_due", now);
            results.push({ org_id: t.id, slug: t.slug, kind: "past_due", sent: true });
          } catch (e: any) {
            results.push({ org_id: t.id, slug: t.slug, kind: "past_due", sent: false, reason: e?.message || "send failed" });
          }
        } else {
          results.push({ org_id: t.id, slug: t.slug, kind: "past_due", sent: false, reason: "no owner email" });
        }
      }
    }
  }

  return results;
}

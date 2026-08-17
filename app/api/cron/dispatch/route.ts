// ============================================================
//  GET /api/cron/dispatch
//
//  Single Vercel cron entry. Routes by UTC date to the underlying
//  job so we stay under Vercel Hobby's 2-cron-job limit.
//
//  Schedule (vercel.json): "0 12 * * *"   — daily at 12:00 UTC.
//
//  Date-routed jobs (only fire on specific days):
//    day 1   → summary-email    bucket=mid + monthly-backup
//    day 15  → generate-payouts bucket=mid
//    day 17  → summary-email    bucket=end
//    day 28..last-of-month → generate-payouts bucket=end
//      (the underlying generator handles idempotency, so firing
//       every day 28..31 is safe — only the last actual day of
//       the month will produce work for short months.)
//
//  Every-day jobs (run on every dispatch):
//    sendDueBroadcasts        — flushes any broadcasts whose send-time has come
//    processBillingReminders  — platform-level trial + past-due nudges
//
//  Auth: Authorization: Bearer ${CRON_SECRET} via timingSafeEqual.
// ============================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sendDueBroadcasts } from "@/app/lib/broadcasts";
import { emailMonthlyBackup } from "@/app/lib/backup";
import { processBillingReminders } from "@/app/lib/billing-reminders";
import { supabaseService } from "@/app/lib/supabase/server";

// The daily cron does a database backup, all due broadcasts, billing reminders
// and payout generation in ONE invocation. At the platform default budget the
// work after the backup was simply never reached — silently, because the only
// signal is a missing log line.
export const maxDuration = 300;

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(req: Request) {
  // One deadline for the whole invocation. The platform ceiling is 60s here
  // regardless of maxDuration, and the backup, broadcasts and billing
  // reminders all share it - so each job has to yield time to the next.
  const startedAt = Date.now();
  const auth   = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return new NextResponse("server misconfigured: CRON_SECRET unset", { status: 500 });
  if (!constantTimeEq(auth, `Bearer ${secret}`)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  const url    = new URL(req.url);
  const now    = new Date();
  const day    = now.getUTCDate();

  // Purge spent rate-limit counters FIRST, so a slow job later in this
  // invocation can't starve it. One indexed DELETE, milliseconds. The longest
  // throttle window is 24h, so anything past that has no enforcement value —
  // 7 days is kept only so the operator can still see a weekend attack.
  await supabaseService()
    .from("submit_throttle")
    .delete()
    .lt("last_seen", new Date(Date.now() - 7 * 86400_000).toISOString())
    .then(({ error }) => {
      // Missing table is normal until the migration is hand-applied.
      if (error && (error as any).code !== "42P01" && (error as any).code !== "PGRST205") {
        console.warn("[cron/dispatch] submit_throttle purge failed:", error.message);
      }
    }, () => {});

  // Build explicit schedule. Kept inline (not via helper above) so it's
  // dead-obvious from one read what fires on which day.
  type FireSpec = { label: string; path: string; query: string; method: "POST" | "GET" };
  const fires: FireSpec[] = [];
  if (day === 1)  fires.push({ label: "summary-email mid",   path: "/api/cron/summary-email",    query: "bucket=mid", method: "GET" });
  // Monthly backup: also fires on day 1.
  const backupResult = day === 1 ? await emailMonthlyBackup().catch((e) => ({ ok: false, error: e?.message })) : null;
  if (day === 15) fires.push({ label: "generate-payouts mid", path: "/api/cron/generate-payouts", query: "bucket=mid", method: "GET" });
  if (day === 17) fires.push({ label: "summary-email end",   path: "/api/cron/summary-email",    query: "bucket=end", method: "GET" });
  if (day >= 28 && day <= 31) {
    fires.push({ label: "generate-payouts end", path: "/api/cron/generate-payouts", query: "bucket=end", method: "GET" });
  }

  // Always process scheduled broadcasts whose time has come, regardless
  // of the date-specific jobs above.
  const broadcastResults = await sendDueBroadcasts({ totalBudgetMs: Math.max(5_000, 45_000 - (Date.now() - startedAt)) }).catch((e) => ({ error: e?.message ?? "failed" } as any));

  // Platform-level billing reminders (trial-ending + past-due nudges).
  // Runs every day; per-tenant logic decides whether anyone gets emailed.
  const reminderResults = await processBillingReminders(now).catch((e) => ({ error: e?.message ?? "failed" } as any));

  if (fires.length === 0) {
    return NextResponse.json({ ok: true, day, fired: [], broadcasts: broadcastResults, billing_reminders: reminderResults, backup: backupResult, note: "no date-specific job scheduled" });
  }

  const results: any[] = [];
  for (const f of fires) {
    try {
      // Reuse existing single-purpose endpoints — they already enforce
      // the same Bearer secret + handle their own logging.
      const res = await fetch(`${url.origin}${f.path}?${f.query}`, {
        method:  f.method,
        headers: { authorization: `Bearer ${secret}` },
      });
      const text = await res.text();
      results.push({ label: f.label, status: res.status, body: safeJson(text) });
    } catch (e: any) {
      results.push({ label: f.label, error: e?.message || "fetch failed" });
    }
  }

  return NextResponse.json({ ok: true, day, fired: results, broadcasts: broadcastResults, billing_reminders: reminderResults, backup: backupResult });
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return s.slice(0, 200); }
}

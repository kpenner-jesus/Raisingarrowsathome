// ============================================================
//  submit-throttle.ts — the IO half of the application funnel's
//  rate limiter. Every decidable rule lives in
//  submit-throttle-logic.ts; this file only talks to Postgres.
//
//  FAILS OPEN, deliberately. See shouldFailOpen() below.
// ============================================================

import { supabaseService } from "@/app/lib/supabase/server";
import { sendAdminAlert } from "@/app/lib/alerts";
import {
  parseLimits,
  pickClientIp,
  normalizeEmail,
  buildBuckets,
  decideThrottle,
  type ThrottleRow,
  type ThrottleVerdict,
} from "@/app/lib/submit-throttle-logic";

/*
 * Why fail open rather than closed.
 *
 * The textbook answer is fail closed: a control that cannot evaluate should
 * deny, or an attacker who can make Postgres wobble gets an unlimited funnel
 * exactly when they want one.
 *
 * The answer here is different because of what failure actually looks like in
 * THIS project. Migrations are applied by hand, often minutes-to-days after the
 * deploy, so "table missing" is a normal state, not an attack. Add a schema-
 * cache stall, an absent APP_HMAC_SECRET on a preview deploy, or a Supabase
 * blip. In every one of those, failing closed means the charity's ONLY intake
 * funnel rejects every family for as long as it lasts, with nobody watching.
 * And a family that gets an error on a grant application does not open a
 * support ticket — they conclude they were rejected, and they leave.
 *
 * What fail-closed would protect is roughly 100 emails a day. What it would
 * destroy is the charity's intake. So: open, but never silently, and never
 * alone — the honeypot and the answers cap in the route are zero-IO and keep
 * working precisely when this does not.
 */

let tableReady  = false;
let probedAt    = 0;
const RECHECK_MS = 30_000;

/**
 * Only a POSITIVE result is cached for good; a negative one is re-probed.
 * Same reasoning as hasLedger() in broadcasts.ts — a warm lambda that probed
 * before the migration was hand-applied must not keep skipping the limiter
 * forever afterwards.
 */
async function hasThrottleTable(): Promise<boolean> {
  if (tableReady) return true;
  if (Date.now() - probedAt < RECHECK_MS) return false;
  probedAt = Date.now();

  const { error } = await supabaseService()
    .from("submit_throttle").select("org_id", { head: true, count: "exact" }).limit(1);

  // 42P01 = undefined_table. PGRST205 = PostgREST hasn't seen the table yet,
  // which is what supabase-js actually returns for a missing table.
  const missing = !!error && ((error as any).code === "42P01" || (error as any).code === "PGRST205");
  if (error && !missing) {
    console.error("[submit-throttle] probe failed (treating as present):", error.message);
  }
  tableReady = !missing;
  if (missing) {
    console.warn(
      "[submit-throttle] submit_throttle is missing — the application funnel is UNTHROTTLED " +
      "until migration 20260618_submit_throttle is applied",
    );
  }
  return tableReady;
}

// At most one "limiter is dark" alert per lambda per hour, so an outage
// doesn't itself become the mail flood.
let lastDarkAlertAt = 0;
const DARK_ALERT_MS = 3_600_000;

async function alertLimiterDark(orgName: string, reason: string): Promise<void> {
  if (Date.now() - lastDarkAlertAt < DARK_ALERT_MS) return;
  lastDarkAlertAt = Date.now();
  try {
    await sendAdminAlert({
      title: "Application rate limiting is not running",
      summary:
        `The submission limiter could not be evaluated for ${orgName}, so applications are ` +
        `being accepted without it. This is safe for families but leaves the funnel open to ` +
        `bulk submissions. Reason: ${reason}`,
    });
  } catch {
    /* alerting must never break a submission */
  }
}

// Same shape of dedupe for the daily-quota notice: the operator needs to know
// that confirmation emails have stopped going out, but one notice an hour is
// plenty — the whole point of this branch is that we are already at the mail
// ceiling.
let lastQuotaAlertAt = 0;

/**
 * Tell the operator that applications are still being SAVED but their
 * confirmation emails are being held back.
 */
export async function alertMailQuotaReached(orgName: string, appRef: string): Promise<void> {
  console.warn("[submit-throttle] daily mail quota reached — application saved, emails suppressed", { org: orgName, appRef });
  if (Date.now() - lastQuotaAlertAt < DARK_ALERT_MS) return;
  lastQuotaAlertAt = Date.now();
  try {
    await sendAdminAlert({
      title: `Applications saved, confirmation emails paused — ${orgName}`,
      summary:
        `Today's submission limit has been reached, so new applications are still being saved ` +
        `but families are NOT receiving their confirmation email. They are all in the admin ` +
        `console under Applications. Most recent reference: ${appRef}.`,
    });
  } catch {
    /* alerting must never break a submission */
  }
}

export interface ThrottleContext {
  orgId:   string;
  orgName: string;
  headers: Headers;
  email:   string | null | undefined;
}

/**
 * Count this submission attempt and say what the route should do.
 * Never throws.
 */
export async function checkSubmitThrottle(ctx: ThrottleContext): Promise<ThrottleVerdict> {
  const secret = process.env.APP_HMAC_SECRET || process.env.CRON_SECRET || "";
  if (!secret) {
    console.error("[submit-throttle] APP_HMAC_SECRET is unset — failing OPEN (cannot hash identifiers)");
    await alertLimiterDark(ctx.orgName, "APP_HMAC_SECRET is not configured");
    return { action: "allow" };
  }

  try {
    if (!(await hasThrottleTable())) {
      await alertLimiterDark(ctx.orgName, "the submit_throttle table has not been created yet");
      return { action: "allow" };
    }

    const headerBag: Record<string, string | null> = {
      "x-vercel-forwarded-for": ctx.headers.get("x-vercel-forwarded-for"),
      "x-real-ip":              ctx.headers.get("x-real-ip"),
      "x-forwarded-for":        ctx.headers.get("x-forwarded-for"),
    };
    // Off-Vercel the forwarding headers are caller-controlled, so the IP
    // buckets would be bypassable per request. Skip them rather than pretend.
    const ip = pickClientIp(headerBag, { trustProxy: process.env.VERCEL === "1" });

    const buckets = buildBuckets({
      secret,
      ip,
      email:  normalizeEmail(ctx.email),
      orgId:  ctx.orgId,
      limits: parseLimits(process.env),
    });

    const { data, error } = await supabaseService().rpc("application_submit_throttle", {
      p_org_id:  ctx.orgId,
      p_buckets: buckets.map((b) => ({ scope: b.scope, key: b.key, limit: b.limit, window_s: b.window_s })),
    });

    if (error) {
      console.error("[submit-throttle] RPC failed — failing OPEN:", error.message);
      await alertLimiterDark(ctx.orgName, `the throttle function returned an error (${error.message})`);
      return { action: "allow" };
    }

    const verdict = decideThrottle((data ?? []) as ThrottleRow[]);

    if (verdict.action !== "allow") {
      // Observable, but never with a raw IP or email in it. Eight hex
      // characters of the bucket key is enough to correlate two events as
      // "same source" without identifying who that source is.
      const denied = (data as ThrottleRow[]).find((r) => r?.evaluated && !r.allowed);
      const spec   = buckets.find((b) => b.scope === (denied?.out_scope as any));
      console.warn("[submit-throttle] throttled", {
        org:    ctx.orgName,
        scope:  denied?.out_scope,
        hits:   denied?.hits,
        limit:  denied?.lim,
        source: spec ? spec.key.slice(0, 8) : "?",
      });
    }

    return verdict;
  } catch (e: any) {
    console.error("[submit-throttle] unexpected failure — failing OPEN:", e?.message || e);
    await alertLimiterDark(ctx.orgName, `an unexpected error (${e?.message || e})`);
    return { action: "allow" };
  }
}

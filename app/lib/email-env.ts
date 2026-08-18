// ============================================================
//  email-env.ts — stamp every outgoing email with the environment
//  that sent it, and decide whether an inbound webhook event
//  belongs to THIS deployment.
//
//  Why this exists: production and staging are the same Vercel
//  project sharing ONE Resend account and ONE API key. Resend has
//  no notion of environments, and a webhook endpoint can only be
//  filtered by EVENT TYPE — not by sender, key, or domain. So
//  Resend fires the single configured endpoint (the production
//  URL) for every email the account sends, including staging's,
//  and the handler writes the row into the production database.
//
//  Confirmed in the wild: an application submitted on STAGING put
//  sent+delivered rows into the PRODUCTION email_events table.
//
//  The only thing that can tell those apart is a marker we put on
//  the email ourselves.
// ============================================================

/** Resend tag values may contain ONLY ASCII letters, numbers, _ and -. */
const TAG_SAFE = /^[A-Za-z0-9_-]+$/;

export const ENV_TAG_NAME = "env";

/**
 * Which environment is this process?
 *
 * VERCEL_ENV, not NODE_ENV. NODE_ENV is the string "production" for EVERY
 * deployed build on Vercel — main and staging alike — which is exactly why the
 * webhook's existing `NODE_ENV === "production"` guard never noticed the leak.
 *
 * And not NEXT_PUBLIC_ENV either: it is operator-typed and inlined at build
 * time, and app/lib/impersonation.ts already carries a post-mortem explaining
 * why it was abandoned as a safety gate ("'prod', 'Production', or a staging
 * value copied between environments all read as 'not production'").
 *
 * VERCEL_ENV is set by the platform, cannot be fat-fingered, and is readable
 * at request time. It is "production" on main and "preview" on the staging
 * branch and every preview deploy.
 */
export function emailEnv(): string {
  const v = (process.env.VERCEL_ENV || "development").trim();
  // A value Resend would reject would make the SEND fail, which is far worse
  // than the leak. Fall back rather than risk that.
  return TAG_SAFE.test(v) ? v : "development";
}

/** Tags to attach to an outgoing send. Same shape for the SDK and the REST API. */
export function envTags(): Array<{ name: string; value: string }> {
  return [{ name: ENV_TAG_NAME, value: emailEnv() }];
}

/**
 * Read the env marker back off a webhook payload's `data`.
 *
 * THE SHAPE IS ASYMMETRIC AND THIS IS THE WHOLE TRAP.
 *   sending  → tags: [{ name: "env", value: "production" }]   (array of objects)
 *   webhook  → tags: { env: "production" }                    (object, keyed by name)
 *
 * Code that does `data.tags.find(t => t.name === "env")` returns undefined on
 * every real event — which reads as "untagged", so nothing is ever dropped and
 * the fix silently does nothing. The array form is still accepted below purely
 * so this keeps working if Resend ever changes its mind.
 *
 * Returns null when there is no marker at all.
 */
export function eventEnv(data: any): string | null {
  const tags = data?.tags;
  if (!tags) return null;

  if (Array.isArray(tags)) {
    const hit = tags.find((t: any) => t?.name === ENV_TAG_NAME);
    const v = hit?.value;
    return typeof v === "string" && v ? v : null;
  }
  if (typeof tags === "object") {
    const v = (tags as Record<string, unknown>)[ENV_TAG_NAME];
    return typeof v === "string" && v ? v : null;
  }
  return null;
}

// ── Keeping practice email away from real people ────────────
//
// Staging's database is a CLONE of production, so every family's real address
// is sitting in it. Anything a tester does there — approving an application,
// marking a payout paid, sending a broadcast — was mailing those real people
// from the charity's own verified domain. They cannot tell it was practice.
//
// So outside production nothing is delivered to the address on the record.
// It either goes to the tester's own inbox, or it does not go at all.

export type Routing =
  | { send: true;  to: string[]; redirectedFrom: string[] | null }
  | { send: false; reason: string; wouldHaveGoneTo: string[] };

/** Where a message should actually be delivered. */
export function routeRecipients(
  original: string | string[],
  opts: { env?: string; redirectTo?: string } = {},
): Routing {
  const to = (Array.isArray(original) ? original : [original]).filter(Boolean);
  const env = opts.env ?? emailEnv();
  const redirect = (opts.redirectTo ?? process.env.STAGING_EMAIL_REDIRECT_TO ?? "").trim();

  if (env === "production") return { send: true, to, redirectedFrom: null };

  if (!redirect) {
    // FAIL SAFE. With no inbox configured, the alternative is delivering
    // practice mail to a real family — so nothing is sent at all.
    return {
      send: false,
      reason: "STAGING_EMAIL_REDIRECT_TO is not set, so practice email is not delivered to anyone",
      wouldHaveGoneTo: to,
    };
  }
  return { send: true, to: [redirect], redirectedFrom: to };
}

/** Make it obvious in the inbox that this is practice, and who it was for. */
export function routedSubject(subject: string, r: Routing): string {
  if (!r.send || !r.redirectedFrom) return subject;
  return `[${emailEnv()} → ${r.redirectedFrom.join(", ")}] ${subject}`;
}

/** Banner for the top of a redirected message body. */
export function routedNotice(r: Routing): string {
  if (!r.send || !r.redirectedFrom) return "";
  return `<div style="background:#fff4e5;border:1px solid #f0c98a;border-radius:8px;padding:10px 14px;margin:0 0 16px;font-family:sans-serif;font-size:13px;color:#7a4b00;">
    <strong>Practice email.</strong> On the live site this would have been sent to
    <strong>${r.redirectedFrom.map((e) => e.replace(/[<>&]/g, "")).join(", ")}</strong>.
    Nobody outside this test received it.
  </div>`;
}

export type RecordDecision =
  | { record: true;  reason: "own-environment" | "untagged" }
  | { record: false; reason: "foreign-environment"; from: string };

/**
 * Should this deployment write a row for this event?
 *
 * UNTAGGED EVENTS ARE KEPT, deliberately. Emails already in flight when this
 * ships carry no marker, and so would any send path we failed to tag. Dropping
 * them would delete real production history to fix a pollution problem — a
 * strictly worse trade. Only an event that positively identifies itself as
 * belonging to a DIFFERENT environment is discarded.
 */
export function shouldRecordEvent(data: any, self: string = emailEnv()): RecordDecision {
  const from = eventEnv(data);
  if (from === null) return { record: true, reason: "untagged" };
  if (from === self) return { record: true, reason: "own-environment" };
  return { record: false, reason: "foreign-environment", from };
}

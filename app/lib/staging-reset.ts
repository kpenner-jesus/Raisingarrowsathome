// ============================================================
//  staging-reset.ts — the interlock in front of "erase all
//  practice data".
//
//  This is the most dangerous button in the product. Everything
//  decidable about whether it may run lives here, as pure
//  functions, so it can be tested exhaustively without a database
//  anywhere near it.
//
//  THE DESIGN RULE: every gate fails CLOSED. Missing config,
//  unrecognised database, unknown environment — all refuse. There
//  is no code path where "I couldn't tell" means "go ahead".
// ============================================================

/** Typed by the operator, and re-checked on the server. Exact match. */
export const RESET_PHRASE = "ERASE STAGING DATA";

/**
 * Supabase projects this feature may NEVER touch, whatever else is configured.
 *
 * Hardcoded on purpose. Everything else here is an allow-list, which is the
 * right shape for a safety gate — but an allow-list only protects you if it is
 * filled in correctly, and the failure we actually fear is a misconfiguration.
 * This is the backstop for the case where someone points the allow-list itself
 * at production. It cannot be overridden by an environment variable; adding a
 * ref here requires a code change and a review.
 */
export const FORBIDDEN_SUPABASE_REFS = [
  "otwrxfjytbhzdkwiebeu", // Raising Arrows PRODUCTION
];

/**
 * Hostnames the real site answers on.
 *
 * Vercel's Promote-to-Production and Instant Rollback can put a build that was
 * COMPILED in the preview scope onto the live domain. NEXT_PUBLIC_* values are
 * inlined at build time, so such a build carries staging's database URL and
 * VERCEL_ENV=preview with it — every other gate here would pass, and the panel
 * would render on the real domain telling the operator "this is the practice
 * site". Refusing on the request's Host closes that, and makes the copy honest.
 */
export const PRODUCTION_HOSTS = [
  "raisingarrowsathome.com",
  "www.raisingarrowsathome.com",
];

export function isProductionHost(host: string | null | undefined): boolean {
  const h = (host ?? "").trim().toLowerCase().split(":")[0];
  if (!h) return false;
  return PRODUCTION_HOSTS.includes(h);
}

/**
 * Pull the project ref out of a Supabase URL.
 * https://abcdefg.supabase.co -> "abcdefg"
 */
export function supabaseRef(url: string | null | undefined): string | null {
  const s = (url ?? "").trim();
  if (!s) return null;
  try {
    const host = new URL(s).hostname.toLowerCase();   // abcdefg.supabase.co
    // The hostname MUST actually be a Supabase project host. Without this,
    // "raisingarrowsathome.com" yields the first label "raisingarrowsathome"
    // — 19 alphanumeric characters, which satisfies a bare length check and so
    // parses as a project "ref" that is not on any deny-list. Anything that
    // isn't a *.supabase.co host fails closed instead.
    if (!host.endsWith(".supabase.co")) return null;
    const ref = host.slice(0, -".supabase.co".length);
    return /^[a-z0-9]{16,}$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

export interface ResetEnv {
  VERCEL_ENV?:                  string;
  NEXT_PUBLIC_SUPABASE_URL?:    string;
  RESET_ALLOWED_SUPABASE_REF?:  string;
  /** Host the request arrived on. Omitted at render time, supplied on POST. */
  requestHost?:                 string | null;
}

export type GuardResult =
  | { allowed: true;  ref: string }
  | { allowed: false; reason: string; status: number };

/**
 * May this deployment erase its own data?
 *
 * Four independent things must all agree. They are deliberately redundant:
 * the scenario that actually frightens me is not "someone clicks the button on
 * production" — the button isn't rendered there — but "a preview deployment is
 * pointed at the production database", where the environment looks harmless and
 * the data is not. Checking the DATABASE IDENTITY, not just the environment
 * name, is what catches that.
 */
export function resetGuard(env: ResetEnv, typedPhrase: unknown): GuardResult {
  // 0. Never on a request that arrived on the live domain, whatever the build
  //    thinks it is. Catches a promoted or rolled-back preview build.
  if (isProductionHost(env.requestHost)) {
    return { allowed: false, status: 403, reason: "this request arrived on the live site" };
  }

  // 1. ALLOW-list, not a deny-list. Only a Vercel preview deployment may erase.
  //
  //    A deny-list on "production" was wrong: off Vercel there is no VERCEL_ENV
  //    at all, so it read as "" and the gate passed — on a developer machine
  //    whose .env.local points NEXT_PUBLIC_SUPABASE_URL at the PRODUCTION
  //    project with a real service-role key. That left the hardcoded deny-list
  //    as the only thing standing in the way, which is not what "belt and
  //    braces" is supposed to mean. Local machines now simply cannot run this.
  const vercelEnv = (env.VERCEL_ENV ?? "").trim();
  if (vercelEnv !== "preview") {
    return {
      allowed: false, status: 403,
      reason: vercelEnv === "production"
        ? "this is the production deployment"
        : "erasing is only possible on a Vercel preview deployment",
    };
  }

  // 2. The feature is OFF unless someone deliberately switched it on for a
  //    specific database. Absent config disables it — it never defaults on.
  const allowed = (env.RESET_ALLOWED_SUPABASE_REF ?? "").trim();
  if (!allowed) {
    return { allowed: false, status: 403, reason: "RESET_ALLOWED_SUPABASE_REF is not configured for this deployment" };
  }

  // 3. The database we are ACTUALLY connected to must be that one. This is the
  //    check that catches a staging deployment wired to the wrong database.
  const ref = supabaseRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!ref) {
    return { allowed: false, status: 500, reason: "cannot determine which database this deployment is using" };
  }
  if (ref !== allowed) {
    return {
      allowed: false, status: 403,
      reason: `this deployment is connected to database "${ref}", which is not the one cleared for erasing`,
    };
  }

  // 4. Backstop: a known production database is refused even if every check
  //    above was satisfied, i.e. even if the allow-list itself is wrong.
  if (FORBIDDEN_SUPABASE_REFS.includes(ref)) {
    return { allowed: false, status: 403, reason: "that database is a production database" };
  }

  // 5. The operator has to type the phrase, and the SERVER checks it. A
  //    confirmation the client can skip is decoration.
  if (typeof typedPhrase !== "string" || typedPhrase !== RESET_PHRASE) {
    return { allowed: false, status: 400, reason: `confirmation phrase did not match — type ${RESET_PHRASE} exactly` };
  }

  return { allowed: true, ref };
}

/** True when the UI should render the button at all. */
export function resetAvailable(env: ResetEnv): boolean {
  // Same gates, minus the typed phrase (which only exists at submit time).
  return resetGuard(env, RESET_PHRASE).allowed;
}

/**
 * What gets erased, in an order that respects foreign keys (children first).
 *
 * This clears the PLAYGROUND: the family-and-receipt lifecycle, so a tester can
 * start uploading receipts again from nothing.
 *
 * Deliberately EXCLUDED — anything to do with who can sign in, or with
 * configuration somebody wrote:
 *   tenants, profiles, org_members  — the org and its people
 *   admin_invites                   — pending admin access, not practice data
 *   app_settings, email_templates, receipt_categories — configuration
 *   api_tokens, tenant_ai_secrets   — credentials
 *
 * submit_throttle is included on purpose: without clearing it, the rate limiter
 * would still be holding yesterday's counts and a tester could not immediately
 * re-submit the application form.
 */
export const WIPE_ORDER: string[] = [
  // leaves first
  "broadcast_sends",
  "email_events",
  "email_optouts",
  "submit_throttle",
  "audit_log",
  "testimonials",
  "application_notes",
  "recipient_notes",
  "photos",
  "receipts",
  // then things pointing at recipients / batches
  "payouts",
  "payout_batches",
  "recipients",
  // then the roots
  "applications",
  "broadcasts",
];

/** Storage buckets whose files belong to the erased rows. */
export const WIPE_BUCKETS = ["receipts", "photos"];

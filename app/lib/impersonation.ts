// ============================================================
//  impersonation.ts — admin "view as test grantee" helper
//
//  HOW IT WORKS
//  ─────────────
//  An admin clicks "View as test grantee" in the admin UI. The
//  POST /api/admin/impersonate route sets a httpOnly cookie
//  named `ra_impersonate=<test_recipient_id>` AND wipes the test
//  recipient's receipts/photos/testimonials/payouts so every
//  toggle starts from a clean slate.
//
//  Portal pages call getEffectiveRecipient(userId) instead of
//  querying recipients directly. When the cookie is present AND
//  the env is non-production AND the caller is an admin, the
//  helper returns the designated test recipient row. Otherwise
//  it returns the admin's own profile-linked recipient (or null
//  if the admin has no recipient row, which is the normal case).
//
//  SAFETY GATES (all must hold for impersonation to take effect):
//    1. NEXT_PUBLIC_ENV !== "production" — feature 404s in prod.
//    2. Caller is admin or super_admin (cookie alone isn't enough).
//    3. test_recipient_id exists in app_settings.
//    4. The cookie's value matches the configured test_recipient_id
//       (defence-in-depth against tampering).
//
//  All toggles are recorded in audit_log.
// ============================================================

import { cookies } from "next/headers";
import { supabaseService } from "@/app/lib/supabase/server";

export const IMPERSONATE_COOKIE = "ra_impersonate";

/**
 * Is the impersonation feature even available in this deploy?
 * Returns false on production — the feature must NEVER appear there.
 */
export function isImpersonationAllowed(): boolean {
  const env = process.env.NEXT_PUBLIC_ENV;
  // Allowed on staging/preview/development; never on production.
  return env !== "production" && env !== undefined;
}

/**
 * Read the configured test recipient ID from app_settings.
 * Returns null if not configured (feature effectively disabled).
 */
export async function getTestRecipientId(): Promise<string | null> {
  const svc = supabaseService();
  const { data } = await svc
    .from("app_settings")
    .select("value")
    .eq("key", "test_recipient_id")
    .maybeSingle();
  const raw = data?.value;
  // The setting is stored as a JSONB string (`"uuid-here"`), so it comes
  // back as a plain string from Supabase's JSONB→JS deserialisation.
  if (typeof raw === "string" && raw.length > 0) return raw;
  return null;
}

/**
 * Look up a user's role via service-role (no RLS surprises).
 */
async function fetchRole(userId: string): Promise<string | null> {
  const svc = supabaseService();
  const { data } = await svc.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role ?? null;
}

export type EffectiveContext =
  | { mode: "self";    recipient: any | null }
  | { mode: "impersonating"; recipient: any; viewerRole: string };

/**
 * Resolve the recipient row to use for portal queries.
 *
 *  - If impersonating + all gates pass → the test recipient row.
 *  - Otherwise → the user's own profile-linked recipient (or null
 *    when the user has none, which is the normal case for admins).
 */
export async function getEffectiveRecipient(userId: string): Promise<EffectiveContext> {
  const svc = supabaseService();

  // Cookie check (no-op fast path if disabled)
  let impersonating = false;
  let cookieValue: string | null = null;
  if (isImpersonationAllowed()) {
    cookieValue = cookies().get(IMPERSONATE_COOKIE)?.value ?? null;
    if (cookieValue) impersonating = true;
  }

  if (impersonating) {
    const role = await fetchRole(userId);
    const isAdmin = role === "admin" || role === "super_admin";
    const testId = await getTestRecipientId();

    // Defence-in-depth: all four conditions must hold.
    if (isAdmin && testId && cookieValue === testId) {
      const { data: recipient } = await svc
        .from("recipients")
        .select("*, applications(*)")
        .eq("id", testId)
        .maybeSingle();
      if (recipient) {
        return { mode: "impersonating", recipient, viewerRole: role! };
      }
    }
    // If any gate failed, silently fall through to self-mode.
  }

  const { data: recipient } = await svc
    .from("recipients")
    .select("*, applications(*)")
    .eq("profile_id", userId)
    .maybeSingle();

  return { mode: "self", recipient };
}

/**
 * Check whether the current request is currently impersonating.
 * Useful for banner rendering — does NOT enforce role checks (those
 * happen inside getEffectiveRecipient).
 */
export function isCurrentlyImpersonating(): boolean {
  if (!isImpersonationAllowed()) return false;
  return Boolean(cookies().get(IMPERSONATE_COOKIE)?.value);
}

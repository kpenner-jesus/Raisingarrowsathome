// ============================================================
//  tenant-access.ts — single source of truth for "is this tenant
//  allowed to operate right now?"
//
//  tenants.status is a free-text column. Stripe writes raw subscription
//  statuses into it via the webhook (active, trialing, past_due, unpaid,
//  incomplete, incomplete_expired, canceled). A super_admin can also set
//  paused / canceled / free from /platform.
//
//  Rather than a DENY-list of two statuses (which silently let 'unpaid'
//  / 'incomplete*' through → free product after billing stops), we use an
//  ALLOW-list: only these statuses grant access. Anything else — paused,
//  canceled, unpaid, incomplete, incomplete_expired, or any unknown future
//  Stripe status — blocks access.
//
//  Used by: requireAdmin, admin layout, portal layout, MCP route,
//  payouts/generate, and listActiveTenants (cron).
// ============================================================

/** Statuses that grant full tenant access + cron processing. */
export const TENANT_ACTIVE_STATUSES = ["active", "trialing", "past_due", "free"] as const;

/**
 * True when the tenant should be blocked from operating (read + write).
 *
 * `trialEndsAt` matters: 'trialing' is on the allow-list, and NOTHING in the
 * codebase ever moved a tenant off it. Only Stripe or a human in the platform
 * console writes tenants.status, so a self-signup trial simply never expired —
 * every tenant had the product free, forever. Pass the tenant's trial_ends_at
 * and an elapsed trial now blocks like any other inactive status.
 *
 * Omitting it keeps the old behaviour, so a caller that hasn't loaded the
 * column can't accidentally lock a paying tenant out.
 */
export function isTenantAccessBlocked(
  status: string | null | undefined,
  trialEndsAt?: string | null,
): boolean {
  if (!TENANT_ACTIVE_STATUSES.includes((status ?? "") as any)) return true;
  if (status === "trialing" && trialEndsAt) {
    const ends = Date.parse(trialEndsAt);
    if (Number.isFinite(ends) && ends < Date.now()) return true;
  }
  return false;
}

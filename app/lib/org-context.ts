// ============================================================
//  org-context.ts — multi-tenant request → org resolution
//
//  HOW REQUESTS ARE ROUTED TO A TENANT
//  ─────────────────────────────────────
//  1. Custom domain match: if Host header matches tenants.custom_domain,
//     use that tenant. (Reserved for paid tier.)
//  2. Legacy compat: if Host is raisingarrowsathome.com / www. /
//     staging.raisingarrowsathome.com / raising.wildernessedge.biz /
//     raising-staging.wildernessedge.biz → tenant slug 'raising-arrows'.
//  3. Path-based: /o/<slug>/... → tenant with that slug.
//  4. None of the above → null (marketing / signup pages render).
//
//  Middleware writes the resolved slug into an `x-ra-org-slug` header, and
//  strips any client-supplied one. NOTE: middleware's matcher does not cover
//  /api/*, so on those routes the header IS client-supplied - treat it as a
//  hint, exactly like Referer below. Every consumer must still verify the
//  caller's membership of the resolved org (requireAdmin / getEffectiveRecipient
//  do). Never read ctx.id in an /api route without that check.
//  Server components call getOrgContext() to read it.
//
//  PER-REQUEST CACHING
//  ─────────────────────────────────────
//  Tenant lookups are deduped via React's cache() — same slug within the
//  same RSC render returns the same Promise. cache() is scoped to a single
//  request so warm Vercel lambdas don't serve stale data after an
//  admin/branding update.
// ============================================================

import { cache } from "react";
import { headers } from "next/headers";
import { supabaseService } from "@/app/lib/supabase/server";

// Pure helpers re-exported from org-routing.ts so existing callers don't break.
// The pure file is safe to import from tests + middleware.
export {
  parseOrgPath,
  resolveOrgSlug,
  LEGACY_RAISING_ARROWS_HOSTS,
  isLegacyRaisingArrowsHost,
} from "./org-routing";
import {
  resolveOrgSlug as resolveOrgSlugPure,
  parseOrgPath,
  isCandidateCustomDomain,
  normalizeHost,
} from "./org-routing";

export type OrgContext = {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  brand_color: string | null;
  logo_url: string | null;
  custom_domain: string | null;
  sender_email: string | null;
  sender_domain: string | null;
  sender_verified: boolean;
  trial_ends_at: string | null;
  /** Whether the current URL prefixes paths with /o/<slug>/. False for legacy
   *  raisingarrowsathome.com hosts (which keep bare /admin /portal). */
  prefixed: boolean;
};

// Per-request DB lookup. React's cache() dedupes calls within a single RSC
// render and is automatically scoped to the request — no cross-request leak
// in serverless lambda warm-reuse, unlike a module-level Map.
// trial_ends_at is here so the access gate can tell a LIVE trial from a
// lapsed one. Nothing ever moved a tenant off "trialing", so without it a
// self-signup trial simply never ended.
const TENANT_SELECT =
  "id, slug, name, status, plan, brand_color, logo_url, custom_domain, sender_email, sender_domain, sender_verified, trial_ends_at";

const fetchTenantBySlug = cache(async (slug: string) => {
  const svc = supabaseService();
  const { data } = await svc
    .from("tenants")
    .select(TENANT_SELECT)
    .eq("slug", slug)
    .maybeSingle();
  return data;
});

/**
 * Resolve a tenant by their OWN domain (tenants.custom_domain).
 *
 * This is why the custom-domain lookup lives here and not in middleware:
 * middleware only runs for /admin, /portal and /o/*, so every /api/* handler
 * resolves its tenant through this function's Host branch anyway. Doing it in
 * middleware would be duplicate work AND would put a service-role key in the
 * edge bundle — and the tenants table is unreadable by an anonymous client
 * (RLS: is_org_member(id) or is_platform_super()), so an anon lookup there
 * would return nothing at all.
 *
 * Stored values are canonical (bare lowercase host — enforced by a CHECK
 * constraint), so a plain equality match is correct and uses the index.
 */
const fetchTenantByCustomDomain = cache(async (domain: string) => {
  const svc = supabaseService();
  const { data, error } = await svc
    .from("tenants")
    .select(TENANT_SELECT)
    .eq("custom_domain", domain)
    .maybeSingle();
  if (error) {
    console.error("[org-context] custom_domain lookup failed:", error.message, { domain });
    return null;
  }
  return data;
});

/**
 * Read org context from the request — for use in server components and
 * route handlers. Returns null when no org resolves (signup/marketing pages).
 *
 * Resolution order:
 *  1. x-ra-org-slug header (set by middleware for /o/<slug>/* paths).
 *  2. Referer URL path — for client fetches hitting /api/* the request has
 *     no /o/ prefix but the Referer header carries the originating admin
 *     page's URL, which DOES carry /o/<slug>/. This is what lets a path-
 *     routed admin/portal page hit /api/admin/* and resolve back to its
 *     own tenant without every fetch having to call orgPath() first.
 *  3. Host header — legacy raisingarrowsathome.com hosts → raising-arrows.
 *
 * Note on Referer spoofing: a hostile client could lie about the Referer
 * to address a different tenant, but the downstream auth gates
 * (requireAdmin, RLS, etc.) verify org_members.role for the caller's
 * user_id against the resolved org_id — so spoofing the Referer can only
 * land the caller on a tenant they're ALREADY authorized for.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const h = headers();
  let slug     = h.get("x-ra-org-slug");
  let prefixed = h.get("x-ra-org-prefixed") === "1";

  if (!slug) {
    const referer = h.get("referer");
    if (referer) {
      try {
        const refUrl = new URL(referer);
        const fromPath = parseOrgPath(refUrl.pathname);
        if (fromPath) {
          slug = fromPath.slug;
          prefixed = true;
        }
      } catch { /* invalid Referer URL, fall through */ }
    }
  }

  if (!slug) {
    // Use `host`, not `x-forwarded-host`: middleware resolves from `host`, and
    // diverging here would make a request resolve differently depending on
    // whether middleware ran for it.
    const host = h.get("host") || "";
    slug = resolveOrgSlugPure(host, "/");
    prefixed = false;

    // Not one of the platform's own hosts — it may be a tenant's custom
    // domain. The shape guard keeps junk Host headers away from Postgres.
    if (!slug && isCandidateCustomDomain(host)) {
      // normalizeHost, not a hand-rolled copy: it also handles a pasted
      // scheme, an IPv6 literal and a trailing FQDN dot.
      const byDomain = await fetchTenantByCustomDomain(normalizeHost(host));
      // Early return: we already have the whole row, so don't pay a second
      // query re-fetching it by slug below.
      if (byDomain) return { ...(byDomain as any), prefixed: false };
    }
  }
  if (!slug) return null;

  const data = await fetchTenantBySlug(slug);
  return data ? { ...(data as any), prefixed } : null;
}

/**
 * Require an org context — throws/redirects if none resolves. Use at the top
 * of admin/portal page server components.
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) throw new Error("No org context — this page must be reached via a tenant URL.");
  return ctx;
}

/**
 * Build an absolute-path URL for a given pathname, adding the /o/<slug>/
 * prefix when the request came through a path-routed host. Re-exported
 * from org-routing so it stays test-friendly.
 *
 *   orgPath(ctx, "/admin/applications")
 *     → "/admin/applications"             (legacy host)
 *     → "/o/cedar-springs/admin/applications" (path host)
 */
export { orgPath } from "./org-routing";

/** Verify the caller is a member (any role) of the given org. */
export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const svc = supabaseService();
  const { data } = await svc
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

/** Verify the caller is owner OR admin in the given org. */
export async function isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
  const svc = supabaseService();
  const { data } = await svc
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role === "owner" || data?.role === "admin";
}

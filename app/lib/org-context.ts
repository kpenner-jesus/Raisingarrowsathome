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
//  Middleware writes the resolved slug into an `x-ra-org-slug` header.
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
import { resolveOrgSlug as resolveOrgSlugPure } from "./org-routing";

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
  /** Whether the current URL prefixes paths with /o/<slug>/. False for legacy
   *  raisingarrowsathome.com hosts (which keep bare /admin /portal). */
  prefixed: boolean;
};

// Per-request DB lookup. React's cache() dedupes calls within a single RSC
// render and is automatically scoped to the request — no cross-request leak
// in serverless lambda warm-reuse, unlike a module-level Map.
const fetchTenantBySlug = cache(async (slug: string) => {
  const svc = supabaseService();
  const { data } = await svc
    .from("tenants")
    .select("id, slug, name, status, plan, brand_color, logo_url, custom_domain, sender_email, sender_domain, sender_verified")
    .eq("slug", slug)
    .maybeSingle();
  return data;
});

/**
 * Read org context from the request — for use in server components and
 * route handlers. Returns null when no org resolves (signup/marketing pages).
 *
 * Fallback: middleware sets x-ra-org-slug for paths it matches (/admin,
 * /portal, /o/<slug>/*), but NOT for /api/* on legacy hosts. When the
 * header is missing we resolve from the Host header directly so public
 * API routes hit from the apply funnel still find their tenant.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const h = headers();
  let slug     = h.get("x-ra-org-slug");
  let prefixed = h.get("x-ra-org-prefixed") === "1";

  if (!slug) {
    const host = h.get("host") || "";
    // Path is unknown at this layer for header-less callers; resolve from host only.
    slug = resolveOrgSlugPure(host, "/");
    prefixed = false;
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

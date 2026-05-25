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
//  Server components call getOrgContextFromHeaders() to read it.
// ============================================================

import { headers, cookies } from "next/headers";
import { supabaseService } from "@/app/lib/supabase/server";

// Hosts that always resolve to the raising-arrows tenant — preserves the
// original raisingarrowsathome.com URL structure (and the in-network tunnels).
const LEGACY_RAISING_ARROWS_HOSTS = new Set<string>([
  "raisingarrowsathome.com",
  "www.raisingarrowsathome.com",
  "staging.raisingarrowsathome.com",
  "www.staging.raisingarrowsathome.com",
  "raisingarrowsathome.vercel.app",
  "raising.wildernessedge.biz",
  "raising-staging.wildernessedge.biz",
]);

function isLegacyRaisingArrowsHost(host: string): boolean {
  // Strip port for matching.
  const h = host.toLowerCase().split(":")[0];
  if (LEGACY_RAISING_ARROWS_HOSTS.has(h)) return true;
  // Localhost dev — treat as raising-arrows by default so existing
  // /admin and /portal pages keep working without prefixes.
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  return false;
}

/** Parse `/o/<slug>/rest` → { slug, rest }. Returns null if not a path-routed URL. */
export function parseOrgPath(pathname: string): { slug: string; rest: string } | null {
  const m = pathname.match(/^\/o\/([a-z0-9][a-z0-9-]{1,62}[a-z0-9])(\/.*)?$/);
  if (!m) return null;
  return { slug: m[1], rest: m[2] || "/" };
}

/** Resolve org slug for the current request. Pure function — caller provides host + path. */
export function resolveOrgSlug(host: string, pathname: string): string | null {
  const fromPath = parseOrgPath(pathname);
  if (fromPath) return fromPath.slug;
  if (isLegacyRaisingArrowsHost(host)) return "raising-arrows";
  return null;
}

// Cache lookups within a single request to avoid repeat DB hits.
const requestCache = new Map<string, any>();

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

/**
 * Read org context from the request — for use in server components and
 * route handlers. Returns null when no org resolves (signup/marketing pages).
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const h = headers();
  const slug = h.get("x-ra-org-slug");
  if (!slug) return null;
  const prefixed = h.get("x-ra-org-prefixed") === "1";

  const cacheKey = `org:${slug}`;
  if (requestCache.has(cacheKey)) {
    const cached = requestCache.get(cacheKey);
    return cached ? { ...cached, prefixed } : null;
  }

  const svc = supabaseService();
  const { data } = await svc
    .from("tenants")
    .select("id, slug, name, status, plan, brand_color, logo_url, custom_domain, sender_email, sender_domain, sender_verified")
    .eq("slug", slug)
    .maybeSingle();

  requestCache.set(cacheKey, data ?? null);
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
 * prefix when the request came through a path-routed host. Use this for
 * all internal <Link> / router.push targets so cross-host links stay valid.
 *
 *   orgPath(ctx, "/admin/applications")
 *     → "/admin/applications"             (legacy host)
 *     → "/o/cedar-springs/admin/applications" (path host)
 */
export function orgPath(ctx: OrgContext | null, path: string): string {
  if (!ctx || !ctx.prefixed) return path;
  // Strip leading slash for clean concat
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `/o/${ctx.slug}/${clean}`;
}

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

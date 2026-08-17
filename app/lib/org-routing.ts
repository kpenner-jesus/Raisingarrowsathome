// ============================================================
//  org-routing.ts — PURE host/path → org-slug helpers.
//
//  No React, no headers(), no Supabase. Safe to import in tests
//  (vitest, node env) and in the middleware (which can't use
//  next/headers).
//
//  This purity is load-bearing, not stylistic: middleware.ts runs in the
//  EDGE runtime, and Next 14 has no Node-middleware option. Anything that
//  needs a database (custom domains) is resolved one layer up, in
//  getOrgContext() — see the note on isCandidateCustomDomain below.
// ============================================================

// Hosts that always resolve to the raising-arrows tenant — preserves the
// original raisingarrowsathome.com URL structure (and the in-network tunnels).
export const LEGACY_RAISING_ARROWS_HOSTS = new Set<string>([
  "raisingarrowsathome.com",
  "www.raisingarrowsathome.com",
  "staging.raisingarrowsathome.com",
  "www.staging.raisingarrowsathome.com",
  "raisingarrowsathome.vercel.app",
  "raising.wildernessedge.biz",
  "raising-staging.wildernessedge.biz",
]);

/**
 * Reduce a Host header to a bare comparable hostname.
 *
 * Was inline as `host.toLowerCase().split(":")[0]`, which had two real bugs:
 *   - a trailing FQDN dot ("example.com.") never matched anything. Browsers
 *     don't send it; curl and some proxies do.
 *   - an IPv6 literal ("[::1]:3000") became "[" — harmless while nothing was
 *     looked up by host, but it would become a junk database query once
 *     custom domains are resolved.
 */
export function normalizeHost(host: string | null | undefined): string {
  let h = (host ?? "").trim().toLowerCase();
  if (!h) return "";
  if (h.startsWith("http://") || h.startsWith("https://")) h = h.replace(/^https?:\/\//, "");
  h = h.split("/")[0];
  // IPv6 literals are bracketed; the port (if any) follows the closing bracket.
  if (h.startsWith("[")) {
    const close = h.indexOf("]");
    if (close !== -1) return h.slice(0, close + 1);
    return h;
  }
  h = h.split(":")[0];
  if (h.endsWith(".")) h = h.slice(0, -1); // trailing FQDN dot
  return h;
}

/**
 * Build the set of hosts that belong to THE PLATFORM (as opposed to a tenant's
 * own custom domain). Pure: takes an env-shaped object so it is testable.
 *
 * Why this exists: the set used to be 7 hardcoded literals, so every Vercel
 * PREVIEW deployment resolved to no tenant at all — getOrgContext() returned
 * null and app/admin/layout.tsx redirected a signed-in admin to /signup. A
 * working build looked broken, which is a good way to waste an afternoon
 * debugging a phantom.
 *
 * Vercel sets VERCEL_URL / VERCEL_BRANCH_URL / VERCEL_PROJECT_PRODUCTION_URL on
 * every deployment (scheme excluded) and nothing in this repo used them.
 * Matching those EXACTLY covers real preview links with no wildcard, so the
 * security property the tests pin — an unknown host resolves to null — is
 * untouched.
 */
export function platformHostsFrom(env: Record<string, string | undefined>): Set<string> {
  const hosts = new Set<string>(LEGACY_RAISING_ARROWS_HOSTS);
  const add = (raw: string | undefined) => {
    const h = normalizeHost(raw);
    if (h) hosts.add(h);
  };
  for (const part of (env.PLATFORM_HOSTS ?? "").split(",")) add(part);
  add(env.VERCEL_URL);
  add(env.VERCEL_BRANCH_URL);
  add(env.VERCEL_PROJECT_PRODUCTION_URL);
  return hosts;
}

// Referenced statically (never process.env[key] or a spread) so the values
// survive bundling into the edge runtime.
const DEFAULT_PLATFORM_HOSTS = platformHostsFrom({
  PLATFORM_HOSTS:                process.env.PLATFORM_HOSTS,
  VERCEL_URL:                    process.env.VERCEL_URL,
  VERCEL_BRANCH_URL:             process.env.VERCEL_BRANCH_URL,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
});

export function isLegacyRaisingArrowsHost(
  host: string,
  hosts: Set<string> = DEFAULT_PLATFORM_HOSTS,
): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  if (hosts.has(h)) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  return false;
}

// The platform's own first-party charity (the operator running the platform).
// Every OTHER tenant is a SaaS subscriber who brands their OWN charity — they
// upload a logo, pick an accent, and verify their own sending domain. The
// first-party tenant uses the platform defaults (which ARE its real brand +
// already-verified domain), so those SaaS-onboarding steps don't apply to it.
export const PRIMARY_TENANT_SLUG = "raising-arrows";

/** True for the platform's own charity (vs a paying SaaS subscriber tenant). */
export function isPrimaryTenant(slug: string | null | undefined): boolean {
  return slug === PRIMARY_TENANT_SLUG;
}

/** Parse `/o/<slug>/rest` → { slug, rest }. Returns null if not a path-routed URL. */
export function parseOrgPath(pathname: string): { slug: string; rest: string } | null {
  const m = pathname.match(/^\/o\/([a-z0-9][a-z0-9-]{1,62}[a-z0-9])(\/.*)?$/);
  if (!m) return null;
  return { slug: m[1], rest: m[2] || "/" };
}

/** Resolve org slug for the current request. Pure function.
 *
 *  Returns null for a host we don't recognise — that includes a tenant's own
 *  custom domain, which is resolved from the database by getOrgContext().
 *  Keeping "unknown → null" here is a deliberate safety net: it is what stops
 *  an arbitrary Host header from selecting a tenant. */
export function resolveOrgSlug(
  host: string,
  pathname: string,
  hosts: Set<string> = DEFAULT_PLATFORM_HOSTS,
): string | null {
  const fromPath = parseOrgPath(pathname);
  if (fromPath) return fromPath.slug;
  if (isLegacyRaisingArrowsHost(host, hosts)) return PRIMARY_TENANT_SLUG;
  return null;
}

/**
 * Could this host plausibly be a tenant's custom domain, i.e. is it worth a
 * database lookup? Cheap shape guard so junk Host headers never reach Postgres.
 *
 * Rejects: blanks, hosts with no dot, over-length, IP literals, invalid label
 * characters, and anything that is already one of the platform's own hosts.
 */
export function isCandidateCustomDomain(
  host: string,
  hosts: Set<string> = DEFAULT_PLATFORM_HOSTS,
): boolean {
  const h = normalizeHost(host);
  if (!h || h.length < 4 || h.length > 253) return false;
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  if (hosts.has(h)) return false;
  if (h.startsWith("[")) return false;                  // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;  // IPv4 literal
  if (!h.includes(".")) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h);
}

/**
 * Normalize operator-typed input into the canonical stored form, or null to
 * clear it. This is the ONLY place user input becomes routing configuration,
 * so it is strict: bare lowercase hostname, no scheme, port, path or query.
 */
export function normalizeCustomDomainInput(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;                     // empty clears the domain
  if (/\s/.test(trimmed)) return null;
  const h = normalizeHost(trimmed);
  if (!isCandidateCustomDomain(h)) return null;
  if (h.endsWith(".vercel.app")) return null;    // platform-owned, never a tenant's
  return h;
}

/**
 * Build an absolute-path URL for a given pathname, adding the /o/<slug>/
 * prefix when the request came through a path-routed host. Use this for
 * all internal <Link> / router.push targets so cross-host links stay valid.
 *
 * A custom-domain request has prefixed=false, exactly like a legacy host, so
 * it correctly yields bare /admin rather than /o/<slug>/admin.
 */
export function orgPath(ctx: { slug: string; prefixed: boolean } | null, path: string): string {
  if (!ctx || !ctx.prefixed) return path;
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `/o/${ctx.slug}/${clean}`;
}

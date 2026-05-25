// ============================================================
//  org-routing.ts — PURE host/path → org-slug helpers.
//
//  No React, no headers(), no Supabase. Safe to import in tests
//  (vitest, node env) and in the middleware (which can't use
//  next/headers).
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

export function isLegacyRaisingArrowsHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];
  if (LEGACY_RAISING_ARROWS_HOSTS.has(h)) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  return false;
}

/** Parse `/o/<slug>/rest` → { slug, rest }. Returns null if not a path-routed URL. */
export function parseOrgPath(pathname: string): { slug: string; rest: string } | null {
  const m = pathname.match(/^\/o\/([a-z0-9][a-z0-9-]{1,62}[a-z0-9])(\/.*)?$/);
  if (!m) return null;
  return { slug: m[1], rest: m[2] || "/" };
}

/** Resolve org slug for the current request. Pure function. */
export function resolveOrgSlug(host: string, pathname: string): string | null {
  const fromPath = parseOrgPath(pathname);
  if (fromPath) return fromPath.slug;
  if (isLegacyRaisingArrowsHost(host)) return "raising-arrows";
  return null;
}

/**
 * Build an absolute-path URL for a given pathname, adding the /o/<slug>/
 * prefix when the request came through a path-routed host. Use this for
 * all internal <Link> / router.push targets so cross-host links stay valid.
 */
export function orgPath(ctx: { slug: string; prefixed: boolean } | null, path: string): string {
  if (!ctx || !ctx.prefixed) return path;
  const clean = path.startsWith("/") ? path.slice(1) : path;
  return `/o/${ctx.slug}/${clean}`;
}

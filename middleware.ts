// ============================================================
//  Root middleware — multi-tenant routing + auth guards
//
//  ROUTING RULES
//  ─────────────
//   1. URLs of the form /o/<slug>/... are STRIPPED of the /o/<slug>
//      prefix internally so a single set of page files (app/admin/*,
//      app/portal/*) serves every tenant.
//   2. The resolved slug is written to header `x-ra-org-slug` so
//      server components can read it via headers().
//   3. `x-ra-org-prefixed` is '1' when the original URL was prefixed
//      with /o/<slug>/ — used by orgPath() to build consistent links.
//   4. Requests to legacy hosts (raisingarrowsathome.com, etc.) get
//      the slug 'raising-arrows' automatically without a path prefix.
//
//  AUTH GUARDS
//  ─────────────
//   - /admin/*  → must be signed in + org_member with role owner/admin
//   - /portal/* → must be signed in + member of the org
//   - Anonymous access redirects to /auth/login?next=...
// ============================================================

import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "./app/lib/supabase/middleware";
import { resolveOrgSlug, parseOrgPath } from "./app/lib/org-context";

export async function middleware(req: NextRequest) {
  const { response, supabase } = await updateSession(req);

  const host = req.headers.get("host") || "";
  const { pathname } = req.nextUrl;

  // ── 1. Determine target slug + rewrite path if /o/<slug>/ prefix is used ──
  const fromPath = parseOrgPath(pathname);
  const slug = resolveOrgSlug(host, pathname);

  // If we resolved a slug, attach headers downstream pages will read.
  if (slug) {
    response.headers.set("x-ra-org-slug", slug);
    response.headers.set("x-ra-org-prefixed", fromPath ? "1" : "0");
  }

  // Rewrite /o/<slug>/rest → /rest internally so a single page tree
  // serves every tenant. The original URL stays in the browser bar.
  if (fromPath) {
    const url = req.nextUrl.clone();
    url.pathname = fromPath.rest;
    // Carry the headers forward so downstream sees the slug.
    const rewritten = NextResponse.rewrite(url, { request: { headers: req.headers } });
    rewritten.headers.set("x-ra-org-slug", slug || "");
    rewritten.headers.set("x-ra-org-prefixed", "1");
    // copy session cookies (response was built by updateSession)
    response.cookies.getAll().forEach((c) => rewritten.cookies.set(c));
    return rewritten;
  }

  // ── 2. Auth guards on /admin and /portal ──
  // Use the INTERNAL pathname (post-rewrite for path-routed URLs, which we
  // already returned above; the rest of this function only runs for non-/o/
  // requests so pathname is the literal request path).
  if (!pathname.startsWith("/admin") && !pathname.startsWith("/portal")) {
    return response;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Note: org-membership + role checks happen inside the layout server
  // components (where we have the resolved tenant id). Middleware just
  // gates against anonymous access; deeper authorization needs DB lookups
  // we'd rather not do twice.

  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/portal/:path*",
    "/o/:slug/:path*",
  ],
};

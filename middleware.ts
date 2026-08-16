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
// Import pure routing helpers from org-routing (not org-context, which pulls
// in `react`'s cache() and can't run in the edge/middleware runtime).
import { resolveOrgSlug, parseOrgPath } from "./app/lib/org-routing";

export async function middleware(req: NextRequest) {
  const { response, supabase } = await updateSession(req);

  const host = req.headers.get("host") || "";
  const { pathname } = req.nextUrl;

  // ── 1. Determine target slug + rewrite path if /o/<slug>/ prefix is used ──
  const fromPath = parseOrgPath(pathname);
  const slug = resolveOrgSlug(host, pathname);

  // Attach the resolved slug to the REQUEST headers that get forwarded on.
  //
  // This was `response.headers.set(...)`, which puts the value on the reply to
  // the browser — server components read INCOMING request headers, so
  // headers().get("x-ra-org-slug") was always null. getOrgContext() then fell
  // through to its Host fallback, which maps the main domain to the
  // raising-arrows tenant. With a single tenant that happened to be right, so
  // nothing looked broken; a second charity on a path-routed /o/<slug>/ URL
  // resolved to the WRONG tenant, failed the org_members check in the admin
  // layout, and was bounced out of their own admin with no way in.
  //
  // NextResponse.rewrite/next snapshot whatever Headers object they are given,
  // so the mutation has to happen on a copy BEFORE constructing the response.
  const requestHeaders = new Headers(req.headers);
  if (slug) {
    requestHeaders.set("x-ra-org-slug", slug);
    requestHeaders.set("x-ra-org-prefixed", fromPath ? "1" : "0");
  } else {
    // Never let a client-supplied value through: these headers are trusted
    // downstream as "the middleware resolved this tenant".
    requestHeaders.delete("x-ra-org-slug");
    requestHeaders.delete("x-ra-org-prefixed");
  }

  /** Pass-through response carrying the forwarded headers + session cookies. */
  const forward = () => {
    const r = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  // ── 2. Auth guard on /admin and /portal ──
  //
  // This runs BEFORE the rewrite returns. It used to sit after it, so the
  // `if (fromPath) { ...return }` branch skipped the guard entirely — and
  // /o/<slug>/... is the URL shape every SaaS tenant is given at signup.
  // Any portal page that didn't re-check the session itself was therefore
  // reachable signed-out. Guard on the INTERNAL path, since that is the page
  // that will actually render.
  const internalPath = fromPath ? fromPath.rest : pathname;
  const guarded = internalPath.startsWith("/admin") || internalPath.startsWith("/portal");

  if (guarded) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const url = req.nextUrl.clone();
      url.pathname = "/auth/login";
      url.search = "";
      // `next` must be the ORIGINAL path so a path-routed tenant comes back
      // to /o/<slug>/admin rather than bare /admin (which resolves by Host and
      // bounces a non-member of the host-default tenant straight out again).
      // Keep the query string too: an invite link is /admin/onboard?token=...,
      // and dropping the token sent the invitee back to "Missing token".
      url.searchParams.set("next", pathname + (req.nextUrl.search || ""));
      const redirect = NextResponse.redirect(url);
      // carry refreshed session cookies, or a token rotated by updateSession
      // during this request is thrown away and the next request re-refreshes
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }

  // ── 3. Rewrite /o/<slug>/rest → /rest internally so a single page tree
  //       serves every tenant. The original URL stays in the browser bar.
  if (fromPath) {
    const url = req.nextUrl.clone();
    url.pathname = fromPath.rest;
    const rewritten = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    // copy session cookies (response was built by updateSession)
    response.cookies.getAll().forEach((c) => rewritten.cookies.set(c));
    return rewritten;
  }

  // Note: org-membership + role checks happen inside the layout server
  // components (where we have the resolved tenant id). Middleware just
  // gates against anonymous access; deeper authorization needs DB lookups
  // we'd rather not do twice.

  return forward();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/portal/:path*",
    "/o/:slug/:path*",
  ],
};

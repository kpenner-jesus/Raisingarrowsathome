// ============================================================
//  Root middleware — protects /admin and /portal
//
//  Unauthenticated request → /auth/login?next=...
//  Authenticated non-admin on /admin → /portal
// ============================================================

import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "./app/lib/supabase/middleware";

export async function middleware(req: NextRequest) {
  const { response, supabase } = await updateSession(req);

  const { pathname } = req.nextUrl;
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

  if (pathname.startsWith("/admin")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = profile?.role;
    if (role !== "admin" && role !== "super_admin") {
      return NextResponse.redirect(new URL("/portal", req.url));
    }
    // /admin/team is super_admin only
    if (pathname.startsWith("/admin/team") && role !== "super_admin") {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
  }

  return response;
}

export const config = { matcher: ["/admin/:path*", "/portal/:path*"] };

// Magic-link callback. Exchanges the code for a session cookie, then redirects.
//
// Routing rules:
//   - If `next` is an explicit /admin/... or /portal/... path, honor it.
//   - Otherwise, route by role: admin/super_admin → /admin, recipient → /portal.
//
// Security: `next` is only honored if it's a same-origin relative path
// (starts with `/`, not `//`, no scheme, no backslash override).
// Magic-link callback. Uses the official @supabase/ssr Route Handler
// pattern: cookies are set DIRECTLY on the NextResponse we return, so
// Set-Cookie headers actually accompany the redirect. The earlier
// pattern (cookies() from next/headers) wrote to a request cookie
// store that NextResponse.redirect did not include, leaving callers
// unauthenticated downstream.
import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { supabaseService } from "@/app/lib/supabase/server";

function isSafeRelativePath(raw: string | null): boolean {
  if (!raw) return false;
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//"))  return false;
  if (raw.startsWith("/\\")) return false;
  if (/^[a-z]+:/i.test(raw)) return false;
  return true;
}

export async function GET(req: Request) {
  const url  = new URL(req.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next");

  // Build the response up front so the Supabase client can attach
  // Set-Cookie headers to it during exchangeCodeForSession().
  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`))?.[1];
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  let userId: string | null = null;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) console.error("[auth/callback] exchange failed:", error.message);
    userId = data?.user?.id ?? null;
  }
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  // Look up role via the service role (no RLS surprises).
  let role: string | null = null;
  if (userId) {
    const svc = supabaseService();
    const { data: profile, error: profErr } = await svc
      .from("profiles").select("role").eq("id", userId).single();
    if (profErr) console.error("[auth/callback] profile lookup failed:", profErr.message);
    role = profile?.role ?? null;
  }
  const isAdmin = role === "admin" || role === "super_admin";

  // Decide redirect target
  let target: string;
  if (rawNext && isSafeRelativePath(rawNext) && rawNext !== "/portal" && rawNext !== "/admin") {
    const isAdminPath = rawNext === "/admin" || rawNext.startsWith("/admin/");
    target = (!isAdminPath || isAdmin) ? rawNext : (isAdmin ? "/admin" : "/portal");
  } else {
    target = isAdmin ? "/admin" : "/portal";
  }

  // Build the redirect response, copying over the Set-Cookie headers
  // the supabase client wrote into `response`. Use forwarded headers
  // when present so callback works behind a reverse proxy / Cloudflare
  // tunnel — req.url would otherwise resolve to http://localhost:3000.
  const forwardedHost  = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const origin = forwardedHost
    ? `${forwardedProto || "https"}://${forwardedHost}`
    : url.origin;
  const redirect = NextResponse.redirect(new URL(target, origin));
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

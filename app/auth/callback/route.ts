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

  // Resolve the public origin ONCE, up front: both the success redirect and
  // the failure bounce need it. Behind a reverse proxy / Cloudflare tunnel
  // req.url resolves to http://localhost:3000, which would send the user to
  // a host that isn't the one they are browsing.
  const forwardedHost  = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const origin = forwardedHost
    ? `${forwardedProto || "https"}://${forwardedHost}`
    : url.origin;

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
  let authError: string | null = null;

  // Supabase sends one of two link shapes depending on the project's email
  // template. `?code=` is the PKCE flow; `?token_hash=&type=` is the older
  // one. Only the first was handled, so a project on the other template
  // produced a callback that quietly established no session at all.
  const tokenHash = url.searchParams.get("token_hash");
  const otpType   = url.searchParams.get("type");

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) { console.error("[auth/callback] exchange failed:", error.message); authError = error.message; }
    userId = data?.user?.id ?? null;
  } else if (tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: (otpType as any) || "magiclink",
    });
    if (error) { console.error("[auth/callback] verifyOtp failed:", error.message); authError = error.message; }
    userId = data?.user?.id ?? null;
  } else {
    // Supabase puts its own failures in the query string (e.g. otp_expired).
    authError = url.searchParams.get("error_description")
      || url.searchParams.get("error")
      || "That sign-in link didn't carry a login code.";
  }

  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  // No session established → send them back to sign in WITH THE REASON.
  // Previously this fell through and redirected to /admin or /portal anyway,
  // as though the login had worked. Those pages then bounced them back to
  // the login screen with no explanation — the confusing loop that made a
  // failed magic link look like a broken site.
  //
  // The common cause is a link that was already used: mail scanners and
  // "safe links" services fetch the URL before the human clicks it, and a
  // magic link is single-use. Hence the specific wording below.
  if (!userId) {
    const expired = /expired|invalid|already|used/i.test(authError || "");
    const reason  = expired
      ? "That sign-in link has already been used or has expired. Links can only be opened once — request a fresh one below."
      : `We couldn't complete the sign-in.${authError ? ` (${authError})` : ""} Please request a new link.`;
    const back = new URL("/auth/login", origin);
    back.searchParams.set("error", reason);
    if (rawNext && isSafeRelativePath(rawNext)) back.searchParams.set("next", rawNext);
    const bounce = NextResponse.redirect(back);
    response.cookies.getAll().forEach((c) => bounce.cookies.set(c));
    return bounce;
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

  // Build the redirect response, copying over the Set-Cookie headers the
  // supabase client wrote into `response` (origin resolved at the top).
  const redirect = NextResponse.redirect(new URL(target, origin));
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

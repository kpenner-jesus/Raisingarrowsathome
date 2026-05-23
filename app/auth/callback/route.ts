// Magic-link callback. Exchanges the code for a session cookie, then redirects.
//
// Routing rules:
//   - If `next` is an explicit /admin/... or /portal/... path, honor it.
//   - Otherwise, route by role: admin/super_admin → /admin, recipient → /portal.
//
// Security: `next` is only honored if it's a same-origin relative path
// (starts with `/`, not `//`, no scheme, no backslash override).
import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

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

  const supabase = supabaseServer();

  // Exchange the code and capture the resulting user directly. Avoids any
  // race between cookie write and a subsequent getUser() round-trip.
  let userId: string | null = null;
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchange failed:", error.message);
    }
    userId = data?.user?.id ?? null;
  }
  // Fallback: read from cookie if we couldn't get one from the exchange
  // (e.g. user already had a session and just hit /auth/callback).
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  // Look up role via the service role to avoid RLS edge cases.
  let role: string | null = null;
  if (userId) {
    const svc = supabaseService();
    const { data: profile, error: profErr } = await svc
      .from("profiles").select("role").eq("id", userId).single();
    if (profErr) {
      console.error("[auth/callback] profile lookup failed:", profErr.message);
    }
    role = profile?.role ?? null;
  }
  const isAdmin = role === "admin" || role === "super_admin";

  // Honor an explicit deep link if it's a safe relative path.
  //  - /portal and /admin pass through normal role routing below.
  //  - For admin-only paths under /admin, only allow if user is admin.
  if (rawNext && isSafeRelativePath(rawNext) && rawNext !== "/portal" && rawNext !== "/admin") {
    const isAdminPath = rawNext.startsWith("/admin");
    if (!isAdminPath || isAdmin) {
      return NextResponse.redirect(new URL(rawNext, url.origin));
    }
  }

  if (isAdmin) {
    return NextResponse.redirect(new URL("/admin", url.origin));
  }
  return NextResponse.redirect(new URL("/portal", url.origin));
}

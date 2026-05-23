// Magic-link callback. Exchanges the code for a session cookie, then redirects.
//
// Routing rules:
//   - If `next` is an explicit /admin/... or /portal/... path, honor it.
//   - Otherwise, route by role: admin/super_admin → /admin, recipient → /portal.
//
// Security: `next` is only honored if it's a same-origin relative path
// (starts with `/`, not `//`, no scheme, no backslash override).
import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

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
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Honor an explicit deep link if it's a safe relative path.
  if (rawNext && isSafeRelativePath(rawNext) && rawNext !== "/portal" && rawNext !== "/admin") {
    return NextResponse.redirect(new URL(rawNext, url.origin));
  }

  // Otherwise route by role.
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role === "admin" || profile?.role === "super_admin") {
      return NextResponse.redirect(new URL("/admin", url.origin));
    }
  }

  return NextResponse.redirect(new URL("/portal", url.origin));
}

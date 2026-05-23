// Magic-link callback. Exchanges the code for a session cookie, then redirects.
//
// Security: `next` is only honored if it's a same-origin relative path
// (starts with `/`, but not `//` which would be protocol-relative). Anything
// else falls back to `/portal`, preventing open-redirect phishing.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

/** Returns next iff it's a safe same-origin path; otherwise returns "/portal". */
function sanitizeNext(raw: string | null): string {
  if (!raw) return "/portal";
  // Must start with a single slash (relative path), not "//" (protocol-relative),
  // not contain backslashes (Windows-style override), and not be a scheme like `javascript:`.
  if (!raw.startsWith("/")) return "/portal";
  if (raw.startsWith("//"))  return "/portal";
  if (raw.startsWith("/\\")) return "/portal";
  if (/^[a-z]+:/i.test(raw)) return "/portal";
  return raw;
}

export async function GET(req: Request) {
  const url  = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = sanitizeNext(url.searchParams.get("next"));

  if (code) {
    const supabase = supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}

// Magic-link callback. Exchanges the code for a session cookie, then redirects.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

export async function GET(req: Request) {
  const url  = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/portal";

  if (code) {
    const supabase = supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}

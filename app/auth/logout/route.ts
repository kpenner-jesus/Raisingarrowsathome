import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = supabaseServer();
  await supabase.auth.signOut();
  // 303 See Other converts the POST to a GET on redirect, so browser
  // history doesn't keep the form submission (no "Confirm Form
  // Resubmission" dialog on back-nav).
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}

// Allow GET fallback too — if anyone hits /auth/logout directly via a
// link (or the user lands here from a stale POST), sign them out and
// send them home cleanly.
export async function GET(req: Request) {
  const supabase = supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}

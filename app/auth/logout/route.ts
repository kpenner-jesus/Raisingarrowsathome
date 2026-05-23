import { NextResponse } from "next/server";
import { supabaseServer } from "@/app/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", req.url));
}

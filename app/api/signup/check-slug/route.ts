// GET /api/signup/check-slug?slug=<candidate>
//
// Public endpoint used by the /signup/new-org wizard to live-validate
// a slug before the user submits. Returns { available: boolean, reason?: string }.
//
// Validation matches the strict rules enforced by /api/signup/create-org so
// the user can't get a green-check here and then fail on submit.

import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";
import { validateSlug } from "@/app/lib/signup-validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("slug") || "";

  // Shared validator (app/lib/signup-validation.ts) keeps check-slug,
  // create-org, and the unit tests in lockstep — no drift possible.
  const v = validateSlug(raw);
  if (!v.ok) {
    return NextResponse.json({ available: false, reason: v.reason });
  }

  const svc = supabaseService();
  const { data } = await svc
    .from("tenants")
    .select("id")
    .eq("slug", v.slug)
    .maybeSingle();

  if (data) {
    return NextResponse.json({ available: false, reason: "already taken" });
  }
  return NextResponse.json({ available: true });
}

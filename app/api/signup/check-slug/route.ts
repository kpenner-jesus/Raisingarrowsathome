// GET /api/signup/check-slug?slug=<candidate>
//
// Public endpoint used by the /signup/new-org wizard to live-validate
// a slug before the user submits. Returns { available: boolean, reason?: string }.
//
// Validation matches the strict rules enforced by /api/signup/create-org so
// the user can't get a green-check here and then fail on submit.

import { NextResponse } from "next/server";
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

// Keep in sync with RESERVED_SLUGS in /api/signup/create-org.
const RESERVED_SLUGS = new Set<string>([
  "admin", "portal", "apply", "auth", "signup", "platform",
  "api", "_next", "static", "public", "o",
  "raising-arrows",
]);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("slug") || "";
  const slug = raw.trim().toLowerCase();

  if (!slug) {
    return NextResponse.json({ available: false, reason: "empty" }, { status: 200 });
  }
  if (slug.length < 3) {
    return NextResponse.json({ available: false, reason: "too short — minimum 3 characters" });
  }
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ available: false, reason: "lowercase letters, digits, hyphens only — must start + end alphanumeric" });
  }
  if (RESERVED_SLUGS.has(slug)) {
    return NextResponse.json({ available: false, reason: "this URL is reserved — pick another" });
  }

  const svc = supabaseService();
  const { data } = await svc
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (data) {
    return NextResponse.json({ available: false, reason: "already taken" });
  }
  return NextResponse.json({ available: true });
}

// POST /api/signup/create-org
// Authenticated request. Creates a tenant + adds caller as owner.
// Returns redirect_url that points at the new tenant's admin.
//
// Slug uniqueness is enforced at the DB level. Reserved slugs (those
// that conflict with our route names) are rejected.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { sendWelcomeToNewOrgOwner } from "@/app/lib/notify-platform";

export const dynamic = "force-dynamic";

// Reserved slugs — anything that conflicts with a top-level Next.js route.
const RESERVED_SLUGS = new Set<string>([
  "admin", "portal", "apply", "auth", "signup", "platform",
  "api", "_next", "static", "public", "o",
  "raising-arrows", // reserve so existing tenant can't be impersonated by signup
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const name           = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const slug           = typeof body?.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const charity_number = typeof body?.charity_number === "string" ? body.charity_number.trim().slice(0, 40) : null;

  if (!name)                  return NextResponse.json({ error: "Organization name is required." }, { status: 400 });
  if (!SLUG_RE.test(slug))    return NextResponse.json({ error: "URL slug must be 3–64 lowercase letters/digits/hyphens, starting + ending alphanumeric." }, { status: 400 });
  if (RESERVED_SLUGS.has(slug)) return NextResponse.json({ error: "That URL is reserved. Please pick another." }, { status: 400 });

  const svc = supabaseService();

  // Make sure profile row exists for this user — the auth trigger should
  // already have created it, but the FK on org_members.user_id targets profiles.id.
  await svc.from("profiles").upsert({
    id:    user.id,
    email: user.email,
    role:  "recipient",
  }, { onConflict: "id" }).select();

  // Insert the tenant. Slug uniqueness errors caught + surfaced.
  const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: tenant, error: insErr } = await svc.from("tenants").insert({
    slug,
    name,
    charity_number,
    owner_id: user.id,
    status: "trialing",
    plan: "basic",
    trial_ends_at: trialEnds,
    brand_color: "#e8793a",
  }).select("id, slug, name").single();

  if (insErr) {
    if (insErr.code === "23505") {
      return NextResponse.json({ error: "That URL is taken. Try another." }, { status: 409 });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Add the user as owner of the new tenant.
  await svc.from("org_members").insert({
    org_id:  tenant.id,
    user_id: user.id,
    role:    "owner",
  });

  // Decide redirect URL based on the host that received the request.
  // Custom-domain tenants don't exist yet at signup time, so the only two
  // shapes are legacy raisingarrowsathome.com hosts (bare /admin) or path-routed.
  const host = req.headers.get("host") || "";
  const isLegacyRaisingHost = (() => {
    const h = host.toLowerCase().split(":")[0];
    return h === "raisingarrowsathome.com"
      || h === "www.raisingarrowsathome.com"
      || h === "staging.raisingarrowsathome.com"
      || h === "raising.wildernessedge.biz"
      || h === "raising-staging.wildernessedge.biz";
  })();

  // Brand-new tenants always get the /o/<slug>/admin URL. The legacy host
  // path is reserved for the original raising-arrows tenant (already excluded
  // via RESERVED_SLUGS).
  const redirect_url = `/o/${tenant.slug}/admin`;

  // Fire-and-forget welcome email. Failures don't block signup.
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = `${proto}://${host}`;
  const adminUrl = `${origin}${redirect_url}`;
  void sendWelcomeToNewOrgOwner({
    to: user.email ?? "",
    orgName: tenant.name ?? name,
    slug: tenant.slug,
    adminUrl,
    trialEndsAt: new Date(trialEnds),
  }).catch((e) => console.warn("[signup] welcome email failed:", e?.message || e));

  return NextResponse.json({ ok: true, org_id: tenant.id, slug: tenant.slug, redirect_url });
}

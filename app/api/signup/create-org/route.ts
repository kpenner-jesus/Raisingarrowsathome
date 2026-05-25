// POST /api/signup/create-org
// Authenticated request. Creates a tenant + adds caller as owner.
// Returns redirect_url that points at the new tenant's admin.
//
// Slug uniqueness is enforced at the DB level. Reserved slugs (those
// that conflict with our route names) are rejected.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { sendWelcomeToNewOrgOwner } from "@/app/lib/notify-platform";
import { validateSlug } from "@/app/lib/signup-validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const name           = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const slugRaw        = typeof body?.slug === "string" ? body.slug : "";
  const charity_number = typeof body?.charity_number === "string" ? body.charity_number.trim().slice(0, 40) : null;

  if (!name) return NextResponse.json({ error: "Organization name is required." }, { status: 400 });

  // Slug validation lives in app/lib/signup-validation.ts so create-org +
  // check-slug + the unit tests all share one source of truth.
  const v = validateSlug(slugRaw);
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });
  const slug = v.slug;

  const svc = supabaseService();

  // Make sure profile row exists for this user — the auth trigger should
  // already have created it, but the FK on org_members.user_id targets profiles.id.
  // CRITICAL: use ignoreDuplicates so we never overwrite an existing role
  // (e.g. a super_admin signing up to test self-serve must not be demoted).
  await svc.from("profiles").upsert({
    id:    user.id,
    email: user.email,
    role:  "recipient",
  }, { onConflict: "id", ignoreDuplicates: true });

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

  // Add the user as owner of the new tenant. If this fails, the tenant row
  // would be orphaned + the slug permanently burned — so we ROLL BACK by
  // deleting the tenant when the member insert errors out.
  const { error: memberErr } = await svc.from("org_members").insert({
    org_id:  tenant.id,
    user_id: user.id,
    role:    "owner",
  });
  if (memberErr) {
    await svc.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json({ error: "Failed to set up org membership. Please try again." }, { status: 500 });
  }

  // Seed default email templates by copying from the canonical raising-arrows
  // tenant. Best-effort: failures don't block signup since notify.ts has
  // hardcoded HTML fallbacks. Onboarding checklist's 'Customize email
  // templates' step now has rows to render + edit, instead of an empty page.
  try {
    const { data: ra } = await svc.from("tenants").select("id").eq("slug", "raising-arrows").maybeSingle();
    if (ra?.id) {
      const { data: defaults } = await svc.from("email_templates")
        .select("key, subject, body_html, body_text")
        .eq("org_id", ra.id);
      if (defaults && defaults.length > 0) {
        await svc.from("email_templates").insert(
          defaults.map((t: any) => ({
            org_id:    tenant.id,
            key:       t.key,
            subject:   t.subject,
            body_html: t.body_html,
            body_text: t.body_text,
          })),
        );
      }
    }
  } catch (e: any) {
    console.warn("[signup] email_templates seed failed (signup still succeeded):", e?.message || e);
  }

  // Brand-new tenants always get the /o/<slug>/admin URL. The legacy host
  // path is reserved for the original raising-arrows tenant (already excluded
  // via RESERVED_SLUGS).
  const redirect_url = `/o/${tenant.slug}/admin`;

  // Build the welcome-email admin link from the trusted PLATFORM_URL env,
  // NEVER from the request Host header (host-header injection vector — an
  // attacker spoofing Host could put their own domain into a real welcome email).
  const platformUrl = process.env.NEXT_PUBLIC_PLATFORM_URL || "https://raisingarrowsathome.com";
  const adminUrl = `${platformUrl}${redirect_url}`;

  // Await the welcome email so a serverless teardown can't kill it mid-flight.
  // Resend round-trips in well under a second; signup latency cost is small.
  try {
    if (user.email) {
      await sendWelcomeToNewOrgOwner({
        to: user.email,
        orgName: tenant.name ?? name,
        slug: tenant.slug,
        adminUrl,
        trialEndsAt: new Date(trialEnds),
      });
    }
  } catch (e: any) {
    console.warn("[signup] welcome email failed (signup still succeeded):", e?.message || e);
  }

  return NextResponse.json({ ok: true, org_id: tenant.id, slug: tenant.slug, redirect_url });
}

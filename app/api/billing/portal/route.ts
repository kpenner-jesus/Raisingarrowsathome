// POST /api/billing/portal
//
// Authenticated request from an org owner. Opens a Stripe Customer
// Portal session so the owner can update their card, see invoices,
// or cancel without needing to email us.
//
// Pre-req: tenant must already have stripe_customer_id (i.e. has gone
// through at least one Checkout). Otherwise we return 400.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { stripe, stripeReady } from "@/app/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const ready = stripeReady();
  if (!ready.ready) return NextResponse.json({ error: `Billing not configured: ${ready.reason}` }, { status: 503 });

  const body = await req.json().catch(() => ({} as any));
  const orgId = typeof body?.orgId === "string" ? body.orgId : null;
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  const svc = supabaseService();

  // Verify caller is owner of this org.
  const { data: membership } = await svc
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Only the org owner can manage billing." }, { status: 403 });
  }

  const { data: tenant } = await svc
    .from("tenants")
    .select("id, slug, stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Org not found." }, { status: 404 });
  if (!tenant.stripe_customer_id) {
    return NextResponse.json({ error: "No Stripe customer yet — finish a Checkout first." }, { status: 400 });
  }

  // Build the absolute return URL from the trusted platform URL env, falling
  // back to the request host. The portal redirects back here when the owner
  // is done — anywhere reasonable is fine; we drop them on billing.
  const platformUrl = process.env.NEXT_PUBLIC_PLATFORM_URL;
  const host  = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = platformUrl || `${proto}://${host}`;
  const returnUrl = `${origin}/o/${tenant.slug}/admin/settings/billing`;

  const sk = stripe();
  const session = await sk.billingPortal.sessions.create({
    customer:   tenant.stripe_customer_id,
    return_url: returnUrl,
  });

  return NextResponse.json({ url: session.url });
}

// POST /api/billing/checkout
//
// Authenticated request from an org owner. Creates (or reuses) a Stripe
// Customer for the tenant, then opens a Checkout Session for the $20/mo
// subscription. Returns { url } — client redirects to Stripe-hosted page.
//
// On success, Stripe redirects back to /o/<slug>/admin/settings/billing
// with ?upgraded=1. The subscription state is synced by the webhook at
// /api/webhooks/stripe.

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

  // Load the tenant (need email for receipt + existing stripe_customer_id).
  const { data: tenant } = await svc
    .from("tenants")
    .select("id, slug, name, stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ error: "Org not found." }, { status: 404 });

  const sk = stripe();
  let customerId = tenant.stripe_customer_id;

  // Lazy-create customer on first checkout.
  if (!customerId) {
    const customer = await sk.customers.create({
      email: user.email ?? undefined,
      name:  tenant.name,
      metadata: { org_id: tenant.id, slug: tenant.slug },
    });
    customerId = customer.id;
    await svc.from("tenants")
      .update({ stripe_customer_id: customerId })
      .eq("id", tenant.id);
  }

  // Build absolute return URLs using the forwarded host so behind-tunnel
  // requests come back to the same host the user started on.
  const host  = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = `${proto}://${host}`;
  const successUrl = `${origin}/o/${tenant.slug}/admin/settings/billing?upgraded=1`;
  const cancelUrl  = `${origin}/o/${tenant.slug}/admin/settings/billing?cancelled=1`;

  const session = await sk.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    subscription_data: {
      metadata: { org_id: tenant.id, slug: tenant.slug },
    },
    success_url: successUrl,
    cancel_url:  cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  });

  return NextResponse.json({ url: session.url });
}

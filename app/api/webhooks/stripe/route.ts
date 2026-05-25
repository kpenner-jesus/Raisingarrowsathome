// POST /api/webhooks/stripe
//
// Stripe webhook handler. Verifies signature, then syncs subscription
// state into public.tenants:
//   - customer.subscription.created/updated → tenants.status + plan + period_end
//   - customer.subscription.deleted         → tenants.status = 'canceled'
//   - invoice.payment_failed                → tenants.status = 'past_due'
//   - checkout.session.completed            → links subscription_id
//
// Env required:
//   STRIPE_WEBHOOK_SECRET  — set after creating the webhook in Stripe dashboard

import { NextResponse } from "next/server";
import { stripe } from "@/app/lib/stripe";
import { supabaseService } from "@/app/lib/supabase/server";
import type Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sig    = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "Webhook signature or secret missing" }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (e: any) {
    return NextResponse.json({ error: `Signature verification failed: ${e?.message}` }, { status: 401 });
  }

  const svc = supabaseService();

  async function findTenantBy(customerId?: string | null, subId?: string | null) {
    if (subId) {
      const { data } = await svc.from("tenants").select("id, slug").eq("stripe_subscription_id", subId).maybeSingle();
      if (data) return data;
    }
    if (customerId) {
      const { data } = await svc.from("tenants").select("id, slug").eq("stripe_customer_id", customerId).maybeSingle();
      if (data) return data;
    }
    return null;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId = (session.subscription as string) || null;
      const custId = (session.customer as string) || null;
      const orgId = (session.metadata?.org_id as string) || null;
      if (orgId && subId) {
        await svc.from("tenants").update({
          stripe_subscription_id: subId,
          stripe_customer_id:     custId,
        }).eq("id", orgId);
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const tenant = await findTenantBy(sub.customer as string, sub.id);
      if (tenant) {
        // Stripe SDK shapes have shifted across versions; access these fields
        // via `any` so the build doesn't break when the SDK upgrades.
        const anySub = sub as any;
        const periodEnd: number | null = anySub.current_period_end
          ?? anySub.items?.data?.[0]?.current_period_end
          ?? null;
        const trialEnd: number | null = anySub.trial_end ?? null;
        await svc.from("tenants").update({
          status: sub.status,
          plan:   "basic",
          current_period_end:     periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          trial_ends_at:          trialEnd  ? new Date(trialEnd  * 1000).toISOString() : null,
          stripe_subscription_id: sub.id,
        }).eq("id", tenant.id);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const tenant = await findTenantBy(sub.customer as string, sub.id);
      if (tenant) {
        await svc.from("tenants").update({
          status: "canceled",
        }).eq("id", tenant.id);
      }
      break;
    }

    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      const anyInv = inv as any;
      const subId: string | null = anyInv.subscription
        ?? anyInv.parent?.subscription_details?.subscription
        ?? null;
      const tenant = await findTenantBy(inv.customer as string, subId);
      if (tenant) {
        await svc.from("tenants").update({ status: "past_due" }).eq("id", tenant.id);
      }
      break;
    }

    default:
      // Ignore everything else. We can extend later (refunds, disputes, etc.)
      break;
  }

  return NextResponse.json({ ok: true, event: event.type });
}

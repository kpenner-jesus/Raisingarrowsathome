// POST /api/webhooks/stripe
//
// Stripe webhook handler. Verifies signature, dedupes by event_id, then
// syncs subscription state into public.tenants:
//   - customer.subscription.created/updated → tenants.status + plan + period_end
//   - customer.subscription.deleted         → tenants.status = 'canceled'
//   - invoice.payment_failed                → tenants.status = 'past_due'
//   - checkout.session.completed            → links subscription_id
//
// Env required:
//   STRIPE_WEBHOOK_SECRET  — set after creating the webhook in Stripe dashboard
//
// Idempotency: each event_id is recorded in public.stripe_events on first
// receipt; a UNIQUE-violation on re-delivery returns early without applying
// the side effect twice. DB-update errors throw out of the handler so the
// response is 500 → Stripe retries the webhook automatically.

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

  // ── Idempotency: record the event_id, bail if we've seen it before. ──
  // Stripe retries on 5xx, so without this any side effect (status flip,
  // owner email) could fire multiple times for a single business event.
  const { error: dupErr } = await svc.from("stripe_events").insert({
    event_id:   event.id,
    event_type: event.type,
  });
  if (dupErr) {
    // 23505 = unique_violation → duplicate delivery → acknowledge & exit.
    if ((dupErr as any).code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true, event: event.type });
    }
    // Any other DB error means we couldn't persist the dedupe row; safer to
    // return 500 so Stripe retries than to silently process the event.
    console.error("[webhook] stripe_events insert failed", dupErr);
    return NextResponse.json({ error: dupErr.message }, { status: 500 });
  }

  async function findTenantBy(customerId?: string | null, subId?: string | null) {
    if (subId) {
      const { data } = await svc.from("tenants").select("id, slug, status").eq("stripe_subscription_id", subId).maybeSingle();
      if (data) return data;
    }
    if (customerId) {
      const { data } = await svc.from("tenants").select("id, slug, status").eq("stripe_customer_id", customerId).maybeSingle();
      if (data) return data;
    }
    return null;
  }

  // Helper: do a tenants UPDATE and throw on error so we 500 (and Stripe retries).
  async function updateTenant(id: string, patch: Record<string, any>) {
    const { error } = await svc.from("tenants").update(patch).eq("id", id);
    if (error) {
      console.error("[webhook] tenant update failed", { id, patch, error });
      throw error;
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId  = (session.subscription as string) || null;
        const custId = (session.customer as string) || null;
        const orgId  = (session.metadata?.org_id as string) || null;
        if (orgId && subId) {
          await updateTenant(orgId, {
            stripe_subscription_id: subId,
            stripe_customer_id:     custId,
          });
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
          const patch: Record<string, any> = {
            status: sub.status,
            plan:   "basic",
            current_period_end:     periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
            trial_ends_at:          trialEnd  ? new Date(trialEnd  * 1000).toISOString() : null,
            stripe_subscription_id: sub.id,
          };
          // Status flipped OFF past_due → clear last-reminder so the next time
          // billing breaks we'll send the first past_due nudge immediately.
          if (tenant.status === "past_due" && sub.status !== "past_due") {
            patch.last_reminder_kind    = null;
            patch.last_reminder_sent_at = null;
          }
          await updateTenant(tenant.id, patch);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const tenant = await findTenantBy(sub.customer as string, sub.id);
        if (tenant) {
          await updateTenant(tenant.id, { status: "canceled" });
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
          await updateTenant(tenant.id, { status: "past_due" });
        }
        break;
      }

      default:
        // Ignore everything else. We can extend later (refunds, disputes, etc.)
        break;
    }
  } catch (e: any) {
    // Any update threw — return 500 so Stripe retries.
    // The stripe_events row stays so the retry will dedupe and we won't
    // double-process — fix the underlying error and reprocess manually.
    return NextResponse.json({ error: e?.message || "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, event: event.type });
}

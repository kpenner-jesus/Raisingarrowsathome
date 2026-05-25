// POST /api/webhooks/stripe
//
// Stripe webhook handler. Verifies signature, then syncs subscription state
// into public.tenants.
//
// Idempotency model:
//   1. INSERT stripe_events { event_id, processed_at = null } — claims the event.
//      ON CONFLICT 23505 → SELECT the existing row. If processed_at IS NOT NULL,
//      we've already done the side effect → ack and exit. If processed_at IS
//      NULL, a previous attempt crashed mid-flight → re-run the side effect.
//   2. Run the side effect (tenants update).
//   3. UPDATE stripe_events SET processed_at = now() — marks the event done.
//
// Why this order: doing the side effect FIRST then marking processed means a
// crash between the two leaves processed_at=NULL → the retry re-runs the side
// effect (which is idempotent — UPDATEs to tenants with same patch are no-ops).
// The OLD order (insert row → run side effect) lost events on any handler
// throw because the retry saw 23505 and acked without re-running.

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

  // ── Idempotency: claim the event_id (insert) or detect already-processed. ──
  const { error: insErr } = await svc.from("stripe_events").insert({
    event_id:   event.id,
    event_type: event.type,
    // processed_at left NULL — will set after side effect succeeds.
  });

  if (insErr) {
    if ((insErr as any).code !== "23505") {
      // Other DB error → return 500, Stripe retries.
      console.error("[webhook] stripe_events insert failed", insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    // 23505 = unique_violation: row already exists. Check if it's been processed.
    const { data: existing } = await svc
      .from("stripe_events")
      .select("processed_at")
      .eq("event_id", event.id)
      .maybeSingle();
    if (existing?.processed_at) {
      return NextResponse.json({ ok: true, duplicate: true, event: event.type });
    }
    // Row exists but processed_at IS NULL → previous attempt crashed mid-flight.
    // Fall through to re-run the side effect (idempotent UPDATEs make this safe).
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
          // Reset reminder state whenever we leave a reminder-applicable status.
          // Covers:
          //   trialing → active     (paid mid-trial; future re-trials should fire fresh reminders)
          //   trialing → canceled   (user bailed; reset for clean slate if they resubscribe)
          //   past_due → !past_due  (resolved card; next past_due fires nudge from scratch)
          const wasTrialing = tenant.status === "trialing";
          const isTrialing  = sub.status   === "trialing";
          const wasPastDue  = tenant.status === "past_due";
          const isPastDue   = sub.status   === "past_due";
          if ((wasTrialing && !isTrialing) || (wasPastDue && !isPastDue)) {
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
          await updateTenant(tenant.id, {
            status: "canceled",
            last_reminder_kind:    null,
            last_reminder_sent_at: null,
          });
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
        break;
    }
  } catch (e: any) {
    // Side effect failed. Leave processed_at NULL so the next retry re-runs.
    return NextResponse.json({ error: e?.message || "handler failed" }, { status: 500 });
  }

  // Side effect succeeded. Mark event processed so future retries ack as
  // duplicate without re-running.
  await svc.from("stripe_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("event_id", event.id);

  return NextResponse.json({ ok: true, event: event.type });
}

// ============================================================
//  stripe.ts — server-side Stripe SDK wrapper
//
//  Env vars required (set in Vercel + .env.local):
//    STRIPE_SECRET_KEY        sk_test_... or sk_live_...
//    STRIPE_PRICE_ID          price_... — the $20/mo recurring product price
//    STRIPE_WEBHOOK_SECRET    whsec_... — set after creating webhook endpoint
//
//  Public envs (not needed server-side but referenced for completeness):
//    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  pk_test_... or pk_live_...
// ============================================================

import Stripe from "stripe";

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  cached = new Stripe(key, {
    // Pin to a known API version so SDK upgrades don't change behaviour.
    apiVersion: "2024-12-18.acacia" as any,
    typescript: true,
  });
  return cached;
}

/** Is Stripe configured well enough to attempt a Checkout call? */
export function stripeReady(): { ready: boolean; reason?: string } {
  if (!process.env.STRIPE_SECRET_KEY)     return { ready: false, reason: "STRIPE_SECRET_KEY missing" };
  if (!process.env.STRIPE_PRICE_ID)       return { ready: false, reason: "STRIPE_PRICE_ID missing" };
  if (!process.env.STRIPE_WEBHOOK_SECRET) return { ready: false, reason: "STRIPE_WEBHOOK_SECRET missing" };
  return { ready: true };
}

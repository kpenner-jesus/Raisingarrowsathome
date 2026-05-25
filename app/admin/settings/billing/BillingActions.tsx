"use client";
// Owner-only billing buttons. Submits to /api/billing/checkout for upgrade
// and (later) /api/billing/portal for managing an existing subscription.

import { useState } from "react";

export function BillingActions({ orgId, status, hasStripeCustomer }: {
  orgId: string;
  status: string;
  hasStripeCustomer: boolean;
}) {
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsUpgrade = status === "trialing" || status === "canceled" || status === "incomplete" || status === "past_due";

  async function checkout() {
    setBusy("checkout"); setError(null);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      window.location.href = j.url;
    } catch (e: any) {
      setError(e?.message || "Failed to open Stripe Checkout");
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: "0.5rem" }}>
      {needsUpgrade ? (
        <>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1rem", lineHeight: 1.55 }}>
            {status === "trialing" && "Upgrade now to lock in your subscription before the trial ends. You'll be billed $20 USD/month."}
            {status === "past_due" && "Your last payment failed. Update your card to keep your portal active."}
            {status === "canceled" && "Your subscription was cancelled. Resubscribe to keep using the platform."}
            {status === "incomplete" && "Subscription setup wasn't finished. Complete it now to activate your portal."}
          </p>
          <button
            onClick={checkout}
            disabled={!!busy}
            className="ra-btn ra-btn-primary"
            style={{
              background: "linear-gradient(180deg, var(--ra-accent, #e8793a), #c45f20)",
              color: "#fff", border: "none", padding: "0.95rem 1.5rem",
              borderRadius: 100, fontWeight: 600, fontSize: "0.95rem",
              cursor: "pointer", minHeight: 52,
              boxShadow: "0 4px 12px rgba(232,121,58,0.35)",
            }}
          >
            {busy === "checkout" ? "Opening Stripe…" : "Upgrade with Stripe →"}
          </button>
          {error && (
            <div style={{ marginTop: "0.75rem", padding: "0.7rem 1rem", borderRadius: 8, background: "rgba(224,80,80,0.08)", color: "#a83232", fontSize: "0.88rem" }}>
              {error}
            </div>
          )}
        </>
      ) : (
        <>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1rem", lineHeight: 1.55 }}>
            Your subscription is active. To update your card, cancel, or view invoices, open the Stripe customer portal.
          </p>
          <p className="ra-quiet" style={{ fontSize: "0.85rem" }}>
            Stripe customer portal coming soon. For now contact{" "}
            <a href="mailto:register@raisingarrowsathome.com" style={{ color: "var(--ra-accent)" }}>register@raisingarrowsathome.com</a>{" "}
            to update payment.
          </p>
        </>
      )}
    </div>
  );
}

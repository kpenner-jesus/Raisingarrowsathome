// /admin/settings/billing
//
// Shows the tenant's current subscription state + provides
// "Upgrade now" (Stripe Checkout) and "Manage billing" (Stripe Portal)
// buttons. Only owners see the actionable buttons; admins see a read-only
// summary.
//
// Behind the scenes:
//   - Subscription state lives on public.tenants (status, plan, current_period_end, trial_ends_at)
//   - Stripe Checkout opens via /api/billing/checkout POST
//   - Stripe Customer Portal opens via /api/billing/portal POST (future)

import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext, orgPath } from "@/app/lib/org-context";
import { BillingActions } from "./BillingActions";

export const dynamic = "force-dynamic";

export default async function BillingSettings({ searchParams }: { searchParams?: { upgraded?: string; cancelled?: string } }) {
  const ctx = await requireOrgContext();
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const svc = supabaseService();
  const { data: membership } = await svc
    .from("org_members")
    .select("role")
    .eq("org_id", ctx.id)
    .eq("user_id", user.id)
    .maybeSingle();
  const isOwner = membership?.role === "owner";

  const { data: tenant } = await svc
    .from("tenants")
    .select("id, name, status, plan, trial_ends_at, current_period_end, stripe_customer_id, stripe_subscription_id")
    .eq("id", ctx.id)
    .maybeSingle();

  const trialEnds = tenant?.trial_ends_at ? new Date(tenant.trial_ends_at) : null;
  const trialDaysLeft = trialEnds ? Math.ceil((trialEnds.getTime() - Date.now()) / 86_400_000) : 0;
  const periodEnd = tenant?.current_period_end ? new Date(tenant.current_period_end) : null;
  const status = tenant?.status ?? "trialing";

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Billing</span>
          <h1 className="ra-h1">Subscription &amp; payments</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            $20 USD/month. All revenue is donated to{" "}
            <a href="https://raisingarrowsathome.com" style={{ color: "var(--ra-accent)" }}>
              Raising Arrows
            </a>{" "}— a CRA-registered charity.
          </p>
        </div>
      </header>

      {searchParams?.upgraded === "1" && (
        <div className="ra-alert-success" style={{ marginBottom: "1.25rem" }}>
          🎉 Subscription activated. Your trial is now upgraded — your next charge is on{" "}
          {periodEnd ? periodEnd.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" }) : "the renewal date"}.
        </div>
      )}
      {searchParams?.cancelled === "1" && (
        <div className="ra-alert-warning" style={{ marginBottom: "1.25rem", background: "rgba(232,121,58,0.08)", border: "1px solid rgba(232,121,58,0.25)", color: "var(--text-primary)", padding: "0.85rem 1.1rem", borderRadius: 10 }}>
          Checkout was cancelled. You're still on your free trial — upgrade any time before it ends.
        </div>
      )}

      <section className="ra-card" style={{ marginBottom: "1.25rem" }}>
        <h2 className="ra-section-title">Current plan</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginTop: "0.5rem" }}>
          <Stat label="Status" value={statusLabel(status)} accent={status === "active"} />
          <Stat label="Plan" value={tenant?.plan === "basic" ? "Standard — $20/mo" : tenant?.plan ?? "—"} />
          <Stat
            label={status === "trialing" ? "Trial ends" : "Next renewal"}
            value={status === "trialing"
              ? (trialEnds ? `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} (${trialEnds.toLocaleDateString("en-CA", { month: "short", day: "numeric" })})` : "—")
              : (periodEnd ? periodEnd.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" }) : "—")
            }
          />
        </div>
      </section>

      <section className="ra-card">
        <h2 className="ra-section-title">Manage subscription</h2>
        {isOwner ? (
          <BillingActions
            orgId={ctx.id}
            status={status}
            hasStripeCustomer={!!tenant?.stripe_customer_id}
          />
        ) : (
          <p className="ra-quiet" style={{ fontSize: "0.92rem", marginTop: "0.5rem" }}>
            Only the organization owner can manage billing. Ask your owner to upgrade or update payment.
          </p>
        )}
      </section>

      <p className="ra-quiet" style={{ marginTop: "1.25rem", fontSize: "0.85rem" }}>
        <a href={orgPath(ctx, "/admin/settings")} style={{ color: "var(--text-muted)" }}>← back to settings</a>
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.85)",
      border: `1.5px solid ${accent ? "var(--ra-accent, #e8793a)" : "rgba(0,0,0,0.08)"}`,
      borderRadius: 14,
      padding: "1rem 1.1rem",
    }}>
      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.08em", marginBottom: "0.35rem", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.05rem", fontWeight: 600, color: accent ? "var(--ra-accent, #e8793a)" : "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case "trialing":  return "Free trial";
    case "active":    return "Active";
    case "past_due":  return "Past due";
    case "canceled":  return "Canceled";
    case "unpaid":    return "Unpaid";
    case "incomplete":return "Setup incomplete";
    case "paused":    return "Paused";
    default:          return s;
  }
}

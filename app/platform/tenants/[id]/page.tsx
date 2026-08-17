// /platform/tenants/[id] — super-admin drill-down on one tenant.
// Shows billing state, members, recent activity, and pause/resume controls.

import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseService } from "@/app/lib/supabase/server";
import { TenantActions } from "./TenantActions";
import { CustomDomainField } from "./CustomDomainField";

export const dynamic = "force-dynamic";

export default async function TenantDetail({ params }: { params: { id: string } }) {
  const svc = supabaseService();
  const { data: tenant } = await svc
    .from("tenants")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!tenant) notFound();

  // Members + recent activity in parallel.
  const [membersRes, statsRes, recentAppsRes, recentReceiptsRes] = await Promise.all([
    svc.from("org_members")
      .select("user_id, role, created_at, profiles(email)")
      .eq("org_id", tenant.id)
      .order("created_at", { ascending: true }),
    svc.rpc("platform_tenant_stats", { p_org_id: params.id }),
    svc.from("applications")
      .select("id, parent_names, app_ref, status, created_at")
      .eq("org_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(5),
    svc.from("receipts")
      .select("id, amount, currency, status, created_at")
      .eq("org_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const stats = (statsRes.data ?? []).find((r: any) => r.org_id === tenant.id) || {};

  const sectionStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: "1.25rem 1.4rem",
    marginBottom: "1.25rem",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "rgba(255,255,255,0.55)",
    fontWeight: 600,
    marginBottom: "0.25rem",
  };

  return (
    <div>
      <Link href="/platform" style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.88rem", textDecoration: "none" }}>← Tenants</Link>

      <header style={{ margin: "1rem 0 1.5rem" }}>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "2rem", fontWeight: 500, margin: 0 }}>
          {tenant.name}
        </h1>
        <div style={{ color: "rgba(255,255,255,0.55)", fontFamily: "ui-monospace, monospace", fontSize: "0.85rem", marginTop: "0.25rem" }}>
          /o/{tenant.slug}/
          {tenant.custom_domain && <> · {tenant.custom_domain}</>}
        </div>
      </header>

      {/* Billing + status */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Status + billing</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>
          <div><div style={labelStyle}>Status</div><div>{tenant.status}</div></div>
          <div><div style={labelStyle}>Plan</div><div>{tenant.plan}</div></div>
          <div><div style={labelStyle}>Trial ends</div><div>{tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleDateString("en-CA") : "—"}</div></div>
          <div><div style={labelStyle}>Period ends</div><div>{tenant.current_period_end ? new Date(tenant.current_period_end).toLocaleDateString("en-CA") : "—"}</div></div>
          <div><div style={labelStyle}>Stripe customer</div><div style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.78rem" }}>{tenant.stripe_customer_id || "—"}</div></div>
          <div><div style={labelStyle}>Subscription</div><div style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.78rem" }}>{tenant.stripe_subscription_id || "—"}</div></div>
        </div>
        <div style={{ marginTop: "1.25rem" }}>
          <TenantActions orgId={tenant.id} currentStatus={tenant.status} />
        </div>
      </section>

      {/* Their own web address. Until now this column was displayed but could
          not be set, and nothing read it for routing. */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Web address</h2>
        <p style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.55)", margin: "0 0 0.85rem" }}>
          This charity is reachable at <code>/o/{tenant.slug}/</code>. Give them their own
          domain here and requests to it resolve straight to them, with no <code>/o/</code> prefix.
        </p>
        <CustomDomainField orgId={tenant.id} currentDomain={tenant.custom_domain ?? null} />
      </section>

      {/* Stats */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Activity</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem" }}>
          <div><div style={labelStyle}>Members</div><div>{Number(stats.member_count ?? 0)}</div></div>
          <div><div style={labelStyle}>Applications</div><div>{Number(stats.app_count ?? 0)}</div></div>
          <div><div style={labelStyle}>Active families</div><div>{Number(stats.active_recipient_count ?? 0)}</div></div>
          <div><div style={labelStyle}>Pending receipts</div><div>{Number(stats.pending_receipt_count ?? 0)}</div></div>
          <div><div style={labelStyle}>Total paid out</div><div>${Number(stats.total_paid ?? 0).toFixed(2)}</div></div>
        </div>
      </section>

      {/* Members */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Members</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ padding: "0.5rem 0.6rem", color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>Email</th>
              <th style={{ padding: "0.5rem 0.6rem", color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>Role</th>
              <th style={{ padding: "0.5rem 0.6rem", color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {(membersRes.data ?? []).map((m: any) => (
              <tr key={m.user_id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={{ padding: "0.5rem 0.6rem" }}>{m.profiles?.email || m.user_id}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}>{m.role}</td>
                <td style={{ padding: "0.5rem 0.6rem" }}>{m.created_at ? new Date(m.created_at).toLocaleDateString("en-CA") : "—"}</td>
              </tr>
            ))}
            {(membersRes.data ?? []).length === 0 && (
              <tr><td colSpan={3} style={{ padding: "0.85rem 0.6rem", color: "rgba(255,255,255,0.45)" }}>No members.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Recent applications */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Recent applications</h2>
        {(recentAppsRes.data ?? []).length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.45)" }}>No applications yet.</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {(recentAppsRes.data ?? []).map((a: any) => (
              <li key={a.id} style={{ padding: "0.45rem 0", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
                <span>{a.parent_names} <span style={{ color: "rgba(255,255,255,0.5)", fontFamily: "ui-monospace, monospace", fontSize: "0.78rem" }}>{a.app_ref}</span></span>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>{a.status} · {a.created_at ? new Date(a.created_at).toLocaleDateString("en-CA") : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent receipts */}
      <section style={sectionStyle}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Recent receipts</h2>
        {(recentReceiptsRes.data ?? []).length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.45)" }}>No receipts yet.</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {(recentReceiptsRes.data ?? []).map((r: any) => (
              <li key={r.id} style={{ padding: "0.45rem 0", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
                <span>{r.currency || "CAD"} ${Number(r.amount).toFixed(2)}</span>
                <span style={{ color: "rgba(255,255,255,0.5)" }}>{r.status} · {r.created_at ? new Date(r.created_at).toLocaleDateString("en-CA") : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// /platform — list of all tenants with their billing state, member count,
// row counts. Single source of truth for "how big is the platform?".

import Link from "next/link";
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

const PLAN_PRICE_USD: Record<string, number> = {
  free:    0,
  basic:   20,
  pro:     50,
  enterprise: 200,
};

export default async function PlatformDashboard() {
  const svc = supabaseService();

  // Read tenants + per-tenant aggregates via the platform_tenant_stats RPC.
  // The RPC computes exact counts in a single Postgres query (no PostgREST
  // 1000-row cap) so the dashboard stays accurate at any scale.
  const [tenantsRes, statsRes] = await Promise.all([
    svc.from("tenants").select("*").order("created_at", { ascending: false }),
    svc.rpc("platform_tenant_stats"),
  ]);

  const memberCount:         Record<string, number> = {};
  const appCount:            Record<string, number> = {};
  const activeRecipientCount: Record<string, number> = {};
  const pendingReceiptCount:  Record<string, number> = {};
  const totalPaid:            Record<string, number> = {};

  (statsRes.data ?? []).forEach((row: any) => {
    memberCount[row.org_id]            = Number(row.member_count            ?? 0);
    appCount[row.org_id]               = Number(row.app_count               ?? 0);
    activeRecipientCount[row.org_id]   = Number(row.active_recipient_count  ?? 0);
    pendingReceiptCount[row.org_id]    = Number(row.pending_receipt_count   ?? 0);
    totalPaid[row.org_id]              = Number(row.total_paid              ?? 0);
  });

  const tenantsList = (tenantsRes.data ?? []) as any[];

  // Aggregates
  const totalTenants = tenantsList.length;
  const activeTenants = tenantsList.filter((t) => t.status === "active").length;
  const trialingTenants = tenantsList.filter((t) => t.status === "trialing").length;
  const monthlyRevenueUsd = tenantsList
    .filter((t) => t.status === "active")
    .reduce((sum, t) => sum + (PLAN_PRICE_USD[t.plan] ?? 0), 0);

  return (
    <div>
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: "2rem", marginBottom: "1.5rem", fontWeight: 500 }}>
        Tenants
      </h1>

      {/* Aggregate stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <Stat label="Total tenants" value={totalTenants.toString()} />
        <Stat label="Active" value={activeTenants.toString()} accent />
        <Stat label="On trial" value={trialingTenants.toString()} />
        <Stat label="Monthly revenue" value={`$${monthlyRevenueUsd} USD`} />
      </div>

      {/* Tenants table */}
      <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ background: "rgba(0,0,0,0.2)", textAlign: "left" }}>
              <Th>Org</Th>
              <Th>Status</Th>
              <Th>Plan</Th>
              <Th align="right">Members</Th>
              <Th align="right">Apps</Th>
              <Th align="right">Active fam.</Th>
              <Th align="right">Pending receipts</Th>
              <Th align="right">Total paid out</Th>
              <Th>Created</Th>
              <Th>Custom domain</Th>
            </tr>
          </thead>
          <tbody>
            {tenantsList.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <Td>
                  <Link href={`/platform/tenants/${t.id}`} style={{ color: "#fff", textDecoration: "none" }}>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.5)", fontFamily: "ui-monospace, monospace" }}>{t.slug}</div>
                  </Link>
                </Td>
                <Td><StatusPill status={t.status} /></Td>
                <Td>{t.plan}</Td>
                <Td align="right">{memberCount[t.id] ?? 0}</Td>
                <Td align="right">{appCount[t.id] ?? 0}</Td>
                <Td align="right">{activeRecipientCount[t.id] ?? 0}</Td>
                <Td align="right">{pendingReceiptCount[t.id] ?? 0}</Td>
                <Td align="right">${(totalPaid[t.id] ?? 0).toFixed(2)}</Td>
                <Td>{new Date(t.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</Td>
                <Td>{t.custom_domain ?? <span style={{ color: "rgba(255,255,255,0.3)" }}>—</span>}</Td>
              </tr>
            ))}
            {tenantsList.length === 0 && (
              <tr>
                <Td colSpan={10}>
                  <div style={{ padding: "2rem", textAlign: "center", color: "rgba(255,255,255,0.5)" }}>
                    No tenants yet. They'll appear here as soon as anyone signs up at /signup.
                  </div>
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? "rgba(232,121,58,0.12)" : "rgba(255,255,255,0.06)",
      border: `1px solid ${accent ? "rgba(232,121,58,0.4)" : "rgba(255,255,255,0.1)"}`,
      borderRadius: 12,
      padding: "1rem 1.1rem",
    }}>
      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "rgba(255,255,255,0.55)", letterSpacing: "0.08em", marginBottom: "0.35rem", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.65rem", fontWeight: 500, color: accent ? "#e8793a" : "#fff", fontFamily: "Georgia, serif" }}>
        {value}
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th style={{ padding: "0.75rem 1rem", fontWeight: 600, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(255,255,255,0.55)", textAlign: align }}>{children}</th>;
}

function Td({ children, align = "left", colSpan }: { children: React.ReactNode; align?: "left" | "right"; colSpan?: number }) {
  return <td style={{ padding: "0.85rem 1rem", textAlign: align, verticalAlign: "top" }} colSpan={colSpan}>{children}</td>;
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string; label: string }> = {
    trialing:    { bg: "rgba(232,121,58,0.2)",  fg: "#f0a070", label: "trial" },
    active:      { bg: "rgba(58,158,110,0.2)",  fg: "#7cd5a8", label: "active" },
    past_due:    { bg: "rgba(224,80,80,0.2)",   fg: "#ff8888", label: "past due" },
    canceled:    { bg: "rgba(150,150,150,0.2)", fg: "#bbb",    label: "canceled" },
    paused:      { bg: "rgba(150,150,150,0.2)", fg: "#bbb",    label: "paused" },
    free:        { bg: "rgba(58,158,110,0.2)",  fg: "#7cd5a8", label: "free" },
  };
  const c = colors[status] ?? { bg: "rgba(255,255,255,0.1)", fg: "#fff", label: status };
  return (
    <span style={{ display: "inline-block", padding: "0.2rem 0.6rem", borderRadius: 100, background: c.bg, color: c.fg, fontSize: "0.78rem", fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";
import { AvatarRow } from "./_components/Avatar";
import { StatusBadge } from "./_components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const supabase = supabaseServer();
  const [pendingApps, activeRecipients, pendingReceipts, draftBatches, latestApps, latestReceipts] = await Promise.all([
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("recipients").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("receipts").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("payout_batches").select("*", { count: "exact", head: true }).in("status", ["draft", "exported"]),
    supabase.from("applications").select("id, app_ref, parent_names, city, status, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("receipts").select("id, amount, status, created_at, description, recipients!inner(applications!inner(parent_names))").eq("status", "pending").order("created_at", { ascending: false }).limit(5),
  ]);

  const stats = [
    { label: "Pending applications", value: pendingApps.count ?? 0,      href: "/admin/applications", pulse: (pendingApps.count ?? 0) > 0 },
    { label: "Active recipients",    value: activeRecipients.count ?? 0, href: "/admin/recipients" },
    { label: "Receipts to review",   value: pendingReceipts.count ?? 0,  href: "/admin/recipients",   pulse: (pendingReceipts.count ?? 0) > 0 },
    { label: "Open payout batches",  value: draftBatches.count ?? 0,     href: "/admin/payouts",      pulse: (draftBatches.count ?? 0) > 0 },
  ];

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Today</span>
          <h1 className="ra-h1">Welcome back</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Snapshot of what needs your attention.
          </p>
        </div>
      </header>

      <div className="ra-stat-grid" style={{ marginBottom: "2.25rem" }}>
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className={`ra-stat ${s.pulse ? "ra-stat-pulse" : ""} ${s.value > 0 && s.pulse ? "ra-stat-accent" : ""}`}>
            <span className="ra-stat-label">{s.label}</span>
            <span className="ra-stat-value">{s.value}</span>
            <span className="ra-stat-sub">
              {s.value === 0 ? "All clear" : "View →"}
            </span>
          </Link>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
        {/* Latest applications */}
        <section className="ra-card">
          <h3 className="ra-section-title">
            Latest applications
            <Link href="/admin/applications" className="ra-link" style={{ fontSize: "0.78rem", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
              View all
            </Link>
          </h3>
          {latestApps.data && latestApps.data.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {latestApps.data.map((a: any) => (
                <li key={a.id}>
                  <Link href={`/admin/applications/${a.id}`} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem",
                    padding: "0.6rem 0.75rem", margin: "0 -0.75rem",
                    borderRadius: 8, textDecoration: "none", color: "inherit",
                    transition: "background 0.12s",
                  }}>
                    <AvatarRow name={a.parent_names} secondary={`${a.city} · ${a.app_ref}`} />
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ra-empty">
              <div className="ra-empty-icon">✉</div>
              <div className="ra-empty-title">No applications yet</div>
              <div>They'll show up here as families submit.</div>
            </div>
          )}
        </section>

        {/* Pending receipts */}
        <section className="ra-card">
          <h3 className="ra-section-title">
            Receipts awaiting review
            <Link href="/admin/recipients" className="ra-link" style={{ fontSize: "0.78rem", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
              Go to recipients
            </Link>
          </h3>
          {latestReceipts.data && latestReceipts.data.length > 0 ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {latestReceipts.data.map((r: any) => (
                <li key={r.id} className="ra-row-between" style={{ fontSize: "0.9rem", padding: "0.35rem 0" }}>
                  <span>
                    <strong style={{ fontWeight: 500 }}>{r.recipients.applications.parent_names}</strong>{" "}
                    <span className="ra-quiet" style={{ fontSize: "0.85rem" }}>{r.description || "Receipt"}</span>
                  </span>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: "1rem", color: "var(--ra-accent)" }}>
                    ${Number(r.amount).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ra-empty">
              <div className="ra-empty-icon">✓</div>
              <div className="ra-empty-title">Nothing waiting</div>
              <div>All receipts reviewed.</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

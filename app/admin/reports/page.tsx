// /admin/reports — YTD figures + CSV exports.
import Link from "next/link";
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

function startOfYearISO(yr: number) { return `${yr}-01-01T00:00:00Z`; }
function startOfNextYearISO(yr: number) { return `${yr + 1}-01-01T00:00:00Z`; }

export default async function ReportsPage({ searchParams }: { searchParams?: { year?: string } }) {
  const now = new Date();
  const year = searchParams?.year && /^\d{4}$/.test(searchParams.year) ? Number(searchParams.year) : now.getUTCFullYear();
  const start = startOfYearISO(year);
  const end   = startOfNextYearISO(year);

  const svc = supabaseService();
  const [apps, approvedApps, recipients, receipts, payoutsPaid, payoutsOpen] = await Promise.all([
    svc.from("applications").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end),
    svc.from("applications").select("id", { count: "exact", head: true }).eq("status", "approved").gte("created_at", start).lt("created_at", end),
    svc.from("recipients").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end),
    svc.from("receipts").select("amount, reimbursable_amount, currency, category").gte("created_at", start).lt("created_at", end),
    svc.from("payouts").select("amount, currency").eq("status", "paid").gte("paid_at", start).lt("paid_at", end),
    svc.from("payouts").select("amount, currency").in("status", ["scheduled", "approved"]).gte("created_at", start).lt("created_at", end),
  ]);

  const sumPaid = (payoutsPaid.data ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const sumOpen = (payoutsOpen.data ?? []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const sumReceiptCount = receipts.data?.length ?? 0;
  const sumReceiptValue = (receipts.data ?? []).reduce((s: number, r: any) => s + Number(r.reimbursable_amount || 0), 0);

  // Category breakdown
  const byCategory = new Map<string, number>();
  for (const r of receipts.data ?? []) {
    const c = (r as any).category || "uncategorized";
    byCategory.set(c, (byCategory.get(c) ?? 0) + Number((r as any).reimbursable_amount || 0));
  }
  const categoryRows = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]);

  const yearOptions: number[] = [];
  for (let y = now.getUTCFullYear(); y >= 2024; y--) yearOptions.push(y);

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Year in review</span>
          <h1 className="ra-h1">Reports</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Snapshot for the accountant. Exports are CRA-ready CSVs.
          </p>
        </div>
        <form method="get">
          <label className="ra-label" style={{ display: "block" }}>Year</label>
          <select name="year" defaultValue={String(year)} className="ra-input" onChange={(e) => e.currentTarget.form?.submit()}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </form>
      </header>

      <div className="ra-stat-grid" style={{ marginBottom: "1.75rem" }}>
        <div className="ra-stat">
          <span className="ra-stat-label">Applications received</span>
          <span className="ra-stat-value">{apps.count ?? 0}</span>
          <span className="ra-stat-sub">{approvedApps.count ?? 0} approved · {(apps.count ?? 0) - (approvedApps.count ?? 0)} pending/denied</span>
        </div>
        <div className="ra-stat">
          <span className="ra-stat-label">New recipients</span>
          <span className="ra-stat-value">{recipients.count ?? 0}</span>
          <span className="ra-stat-sub">Approved + onboarded in {year}</span>
        </div>
        <div className="ra-stat ra-stat-accent">
          <span className="ra-stat-label">Disbursed (paid)</span>
          <span className="ra-stat-value">${sumPaid.toFixed(2)}</span>
          <span className="ra-stat-sub">Payouts marked paid this year</span>
        </div>
        <div className="ra-stat">
          <span className="ra-stat-label">In flight</span>
          <span className="ra-stat-value">${sumOpen.toFixed(2)}</span>
          <span className="ra-stat-sub">Scheduled / approved, not yet paid</span>
        </div>
        <div className="ra-stat">
          <span className="ra-stat-label">Receipts processed</span>
          <span className="ra-stat-value">{sumReceiptCount}</span>
          <span className="ra-stat-sub">Reimbursable total ${sumReceiptValue.toFixed(2)} CAD</span>
        </div>
      </div>

      <section className="ra-card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="ra-section-title">Receipt categories</h2>
        {categoryRows.length === 0 ? (
          <div className="ra-quiet">No receipts in {year} yet.</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {categoryRows.map(([cat, amt]) => {
              const pct = sumReceiptValue > 0 ? (amt / sumReceiptValue) * 100 : 0;
              return (
                <li key={cat} className="ra-row-between">
                  <span style={{ textTransform: "capitalize", fontWeight: 500 }}>{cat}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span className="ra-tiny">{pct.toFixed(0)}%</span>
                    <span style={{ fontFamily: "var(--font-display)", color: "var(--ra-accent)" }}>${amt.toFixed(2)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="ra-card">
        <h2 className="ra-section-title">Exports</h2>
        <p className="ra-quiet" style={{ marginTop: 0 }}>One-click CSV downloads. Year filter applies where shown.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.6rem" }}>
          <Link href={`/api/admin/exports/transactions?year=${year}`} className="ra-btn ra-btn-primary">⬇ Transactions ledger ({year})</Link>
          <Link href={`/api/admin/exports/receipts?year=${year}`}     className="ra-btn">⬇ All receipts ({year})</Link>
          <Link href={`/api/admin/exports/payouts?year=${year}`}      className="ra-btn">⬇ All payouts ({year})</Link>
          <Link href={`/api/admin/exports/recipients`}                className="ra-btn">⬇ All recipients (current)</Link>
        </div>
      </section>
    </div>
  );
}

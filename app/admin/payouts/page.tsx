import { supabaseServer } from "@/app/lib/supabase/server";
import { StatusBadge } from "../_components/StatusBadge";
import GenerateBatchButton from "./GenerateBatchButton";
import MarkPaidButton from "./MarkPaidButton";
import { DeleteDraftButton } from "./DeleteDraftButton";

export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const supabase = supabaseServer();
  const { data: batches } = await supabase
    .from("payout_batches")
    .select("*")
    .order("scheduled_date", { ascending: false });

  // Counts per status
  const draftN    = (batches || []).filter((b: any) => b.status === "draft").length;
  const exportedN = (batches || []).filter((b: any) => b.status === "exported").length;
  const paidN     = (batches || []).filter((b: any) => b.status === "paid").length;
  const totalPaid = (batches || []).filter((b: any) => b.status === "paid").reduce((s: number, b: any) => s + Number(b.total), 0);

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">CEO Ministries handoff</span>
          <h1 className="ra-h1">Payouts</h1>
          <p className="ra-quiet" style={{ maxWidth: 640, lineHeight: 1.6 }}>
            Batches auto-generate on the 1st of each month. Download the CSV, send to CEO Ministries accounting,
            then mark paid once e-transfers go out.
          </p>
        </div>
        <GenerateBatchButton />
      </header>

      <div className="ra-stat-grid" style={{ marginBottom: "1.5rem" }}>
        <div className="ra-stat">
          <span className="ra-stat-label">Drafts</span>
          <span className="ra-stat-value">{draftN}</span>
          <span className="ra-stat-sub">awaiting CSV export</span>
        </div>
        <div className="ra-stat">
          <span className="ra-stat-label">Exported</span>
          <span className="ra-stat-value">{exportedN}</span>
          <span className="ra-stat-sub">waiting on CEO payment</span>
        </div>
        <div className="ra-stat">
          <span className="ra-stat-label">Paid</span>
          <span className="ra-stat-value">{paidN}</span>
          <span className="ra-stat-sub">completed batches</span>
        </div>
        <div className="ra-stat ra-stat-accent">
          <span className="ra-stat-label">Total paid out</span>
          <span className="ra-stat-value">${totalPaid.toFixed(0)}</span>
          <span className="ra-stat-sub">lifetime</span>
        </div>
      </div>

      <div className="ra-table-card">
        <table className="ra-table">
          <thead>
            <tr>
              <th>Scheduled</th>
              <th>Total</th>
              <th>Status</th>
              <th>CEO ref</th>
              <th>CSV</th>
              <th style={{ textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {(batches || []).map((b: any) => (
              <tr key={b.id}>
                <td>
                  <span style={{ fontWeight: 500 }}>
                    {new Date(b.scheduled_date).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                </td>
                <td>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem" }}>
                    ${Number(b.total).toFixed(2)}
                  </span>
                </td>
                <td><StatusBadge status={b.status} /></td>
                <td className="ra-tiny" style={{ fontFamily: "ui-monospace, monospace" }}>{b.ceo_reference || "—"}</td>
                <td>
                  <a href={`/api/admin/payouts/${b.id}/export`} className="ra-link" style={{ fontSize: "0.85rem" }}>
                    Download
                  </a>
                </td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", gap: "0.4rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {b.status !== "paid" && <MarkPaidButton batchId={b.id} total={Number(b.total)} />}
                    {b.status === "draft" && (
                      <DeleteDraftButton
                        batchId={b.id}
                        total={Number(b.total)}
                        scheduledDate={new Date(b.scheduled_date).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(!batches || batches.length === 0) && (
              <tr>
                <td colSpan={6}>
                  <div className="ra-empty">
                    <div className="ra-empty-icon">$</div>
                    <div className="ra-empty-title">No batches yet</div>
                    <div>Click <strong>Generate batch now</strong> or wait for the monthly cron.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { calcBalance } from "@/app/lib/grant-calc";
import { StatusBadge } from "../_components/StatusBadge";
import { SortHeader } from "../_components/SortHeader";
import GenerateBatchButton from "./GenerateBatchButton";
import MarkPaidButton from "./MarkPaidButton";
import { DeleteDraftButton } from "./DeleteDraftButton";

export const dynamic = "force-dynamic";

/** Compute what a 'Generate batch now' click would produce RIGHT NOW.
 *  Mirrors the eligibility math in /api/admin/payouts/generate so the
 *  preview can't drift from the actual generator. */
async function computeEligiblePreview() {
  const svc = supabaseService();
  const { data: recipients } = await svc.from("recipients").select("*").eq("status", "active");
  if (!recipients) return { activeRecipients: 0, eligibleRecipients: 0, eligibleTotal: 0, pendingReceipts: 0 };

  const recipientIds = recipients.map((r: any) => r.id);
  if (recipientIds.length === 0) return { activeRecipients: 0, eligibleRecipients: 0, eligibleTotal: 0, pendingReceipts: 0 };

  const [{ data: receipts }, { data: payouts }] = await Promise.all([
    svc.from("receipts").select("id, recipient_id, amount, status, reimbursable_amount, currency").in("recipient_id", recipientIds),
    svc.from("payouts").select("recipient_id, amount, status").in("recipient_id", recipientIds),
  ]);

  let eligibleRecipients = 0;
  let eligibleTotal = 0;
  for (const r of recipients) {
    const rec = (receipts ?? []).filter((x: any) => x.recipient_id === r.id);
    const pays = (payouts ?? []).filter((x: any) => x.recipient_id === r.id);
    const committedToDate = pays.filter((p: any) => p.status !== "cancelled").reduce((s: number, p: any) => s + Number(p.amount), 0);
    const paidToDate      = pays.filter((p: any) => p.status === "paid").reduce((s: number, p: any) => s + Number(p.amount), 0);
    const balance = calcBalance({
      receipts: rec as any,
      rate: Number(r.reimbursement_rate),
      cap: Number(r.approved_amount),
      paidToDate,
      committedToDate,
    });
    if (balance.eligibleForNextPayout > 0.01) {
      eligibleRecipients++;
      eligibleTotal += balance.eligibleForNextPayout;
    }
  }

  const pendingReceipts = (receipts ?? []).filter((r: any) => r.status === "pending").length;
  return {
    activeRecipients: recipients.length,
    eligibleRecipients,
    eligibleTotal,
    pendingReceipts,
  };
}

export default async function PayoutsPage({ searchParams }: { searchParams?: { sort?: string; dir?: string } }) {
  const supabase = supabaseServer();

  const VALID = ["scheduled", "total", "status"] as const;
  type Col = typeof VALID[number];
  const SORT_MAP: Record<Col, string> = {
    scheduled: "scheduled_date", total: "total", status: "status",
  };
  const sortRaw = (searchParams?.sort ?? "scheduled") as Col;
  const sortCol: Col = (VALID as readonly string[]).includes(sortRaw) ? sortRaw : "scheduled";
  const dir: "asc" | "desc" = searchParams?.dir === "asc" ? "asc" : "desc";

  const [{ data: batches }, preview] = await Promise.all([
    supabase.from("payout_batches").select("*").order(SORT_MAP[sortCol], { ascending: dir === "asc" }),
    computeEligiblePreview(),
  ]);

  // Counts per status
  const draftN    = (batches || []).filter((b: any) => b.status === "draft").length;
  const exportedN = (batches || []).filter((b: any) => b.status === "exported").length;
  const paidN     = (batches || []).filter((b: any) => b.status === "paid").length;
  const totalPaid = (batches || []).filter((b: any) => b.status === "paid").reduce((s: number, b: any) => s + Number(b.total), 0);

  const nothingToGenerate = preview.eligibleRecipients === 0;

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Sending money to families</span>
          <h1 className="ra-h1">Payouts</h1>
          <p className="ra-quiet" style={{ maxWidth: 640, lineHeight: 1.6 }}>
            The site makes a payout list for you on the 1st and 15th of every month.
            You can also make one anytime. Download the list, send it to CEO Ministries
            so they can mail the e-transfers, then come back and mark it paid.
          </p>
        </div>
        <GenerateBatchButton />
      </header>

      {/* Eligibility preview banner — tells admin what 'Generate batch now' WOULD do */}
      <div className="ra-card" style={{
        marginBottom: "1.25rem",
        background: nothingToGenerate ? "rgba(208,74,74,0.04)" : "rgba(58,158,110,0.04)",
        borderColor: nothingToGenerate ? "rgba(208,74,74,0.25)" : "rgba(58,158,110,0.25)",
      }}>
        <div className="ra-row-between" style={{ gap: "1rem" }}>
          <div>
            <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: "var(--ra-ink-quiet)", marginBottom: "0.3rem" }}>
              If you make a payout list right now
            </div>
            {nothingToGenerate ? (
              <div style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>
                <strong>You'd get an empty list ($0).</strong>{" "}
                {preview.pendingReceipts > 0
                  ? <>There {preview.pendingReceipts === 1 ? "is" : "are"} <strong>{preview.pendingReceipts}</strong> receipt{preview.pendingReceipts === 1 ? "" : "s"} waiting for you to look at. Say yes or no to those first, then come back here.</>
                  : preview.activeRecipients === 0
                    ? <>No families are signed up yet.</>
                    : <>{preview.activeRecipients} famil{preview.activeRecipients === 1 ? "y is" : "ies are"} signed up, but none have approved receipts waiting to be paid out. Wait for them to upload receipts, then say yes to those, then come back here.</>}
              </div>
            ) : (
              <div style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>
                You'd pay <strong>{preview.eligibleRecipients}</strong> famil{preview.eligibleRecipients === 1 ? "y" : "ies"}, totaling <strong>${preview.eligibleTotal.toFixed(2)}</strong>.
                {preview.pendingReceipts > 0 && <> Heads up: {preview.pendingReceipts} receipt{preview.pendingReceipts === 1 ? "" : "s"} still need your decision. Review those first if you want them included.</>}
              </div>
            )}
          </div>
          <div style={{
            textAlign: "right", flexShrink: 0,
            fontFamily: "var(--font-display)", fontSize: "1.8rem",
            color: nothingToGenerate ? "var(--ra-danger)" : "var(--ra-success)",
            lineHeight: 1,
          }}>
            ${preview.eligibleTotal.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="ra-stat-grid" style={{ marginBottom: "1.5rem" }}>
        <div className="ra-stat">
          <span className="ra-stat-label">Lists in progress</span>
          <span className="ra-stat-value">{draftN}</span>
          <span className="ra-stat-sub">ready to download</span>
        </div>
        <div className="ra-stat">
          <span className="ra-stat-label">Sent to CEO</span>
          <span className="ra-stat-value">{exportedN}</span>
          <span className="ra-stat-sub">waiting for CEO Ministries to send the money</span>
        </div>
        <div className="ra-stat">
          <span className="ra-stat-label">Done</span>
          <span className="ra-stat-value">{paidN}</span>
          <span className="ra-stat-sub">families paid</span>
        </div>
        <div className="ra-stat ra-stat-accent">
          <span className="ra-stat-label">Total ever paid</span>
          <span className="ra-stat-value">${totalPaid.toFixed(0)}</span>
          <span className="ra-stat-sub">since we started</span>
        </div>
      </div>

      <div className="ra-table-card">
        <table className="ra-table ra-table-mobile">
          <thead>
            <tr>
              <SortHeader label="Scheduled" col="scheduled" currentSort={sortCol} currentDir={dir} basePath="/admin/payouts" />
              <SortHeader label="Total"     col="total"     currentSort={sortCol} currentDir={dir} basePath="/admin/payouts" />
              <SortHeader label="Status"    col="status"    currentSort={sortCol} currentDir={dir} basePath="/admin/payouts" />
              <th>CEO ref</th>
              <th>CSV</th>
              <th style={{ textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {(batches || []).map((b: any) => (
              <tr key={b.id}>
                <td data-label="Scheduled">
                  <span style={{ fontWeight: 500 }}>
                    {new Date(b.scheduled_date).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}
                  </span>
                </td>
                <td data-label="Total">
                  <span style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem" }}>
                    ${Number(b.total).toFixed(2)}
                  </span>
                </td>
                <td data-label="Status"><StatusBadge status={b.status} /></td>
                <td data-label="CEO ref" className="ra-tiny" style={{ fontFamily: "ui-monospace, monospace" }}>{b.ceo_reference || "—"}</td>
                <td data-label="CSV">
                  <a href={`/api/admin/payouts/${b.id}/export`} className="ra-link" style={{ fontSize: "0.85rem" }}>
                    Download
                  </a>
                </td>
                <td data-label="Action" style={{ textAlign: "right" }}>
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
                    <div className="ra-empty-title">No payout lists yet</div>
                    <div>Click <strong>+ Make a payout list</strong> above, or wait for the next 1st or 15th.</div>
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

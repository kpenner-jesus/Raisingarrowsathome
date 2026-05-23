import { supabaseServer } from "@/app/lib/supabase/server";
import GenerateBatchButton from "./GenerateBatchButton";
import MarkPaidButton from "./MarkPaidButton";

export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const supabase = supabaseServer();
  const { data: batches } = await supabase
    .from("payout_batches")
    .select("*")
    .order("scheduled_date", { ascending: false });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem" }}>Payouts</h1>
        <GenerateBatchButton />
      </div>

      <p style={{ fontSize: "0.85rem", color: "#666", lineHeight: 1.6, marginBottom: "1rem", maxWidth: 720 }}>
        Batches auto-generate at noon UTC on the 1st of each month (Vercel Cron).
        Each batch contains every recipient eligible for a payout based on their approved receipts × reimbursement rate, less what they have already been paid.
        Download the CSV and send it to CEO Ministries accounting. After they pay it out, click <strong>Mark paid</strong>.
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", background: "white", border: "1px solid #e5e5e5", borderRadius: 8, overflow: "hidden" }}>
        <thead>
          <tr>
            <th style={thStyle}>Scheduled</th>
            <th style={thStyle}>Total</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>CEO ref</th>
            <th style={thStyle}>CSV</th>
            <th style={thStyle}>Mark paid</th>
          </tr>
        </thead>
        <tbody>
          {(batches || []).map((b: any) => (
            <tr key={b.id}>
              <td style={tdStyle}>{b.scheduled_date}</td>
              <td style={tdStyle}>${Number(b.total).toFixed(2)}</td>
              <td style={tdStyle}><StatusBadge s={b.status} /></td>
              <td style={tdStyle}>{b.ceo_reference || "—"}</td>
              <td style={tdStyle}><a href={`/api/admin/payouts/${b.id}/export`} style={{ color: "var(--accent)" }}>Download</a></td>
              <td style={tdStyle}>{b.status !== "paid" && <MarkPaidButton batchId={b.id} />}</td>
            </tr>
          ))}
          {(!batches || batches.length === 0) && (
            <tr><td colSpan={6} style={{ ...tdStyle, color: "#888", textAlign: "center" }}>No batches yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const colors: Record<string, string> = { draft: "#999", approved: "#e8793a", exported: "#4a7ec7", paid: "#3a9e6e" };
  const c = colors[s] || "#999";
  return <span style={{ background: c + "22", color: c, padding: "2px 8px", borderRadius: 4, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s}</span>;
}

const thStyle: React.CSSProperties = { textAlign: "left", padding: "0.6rem 0.9rem", borderBottom: "1px solid #eee", fontSize: "0.78rem", textTransform: "uppercase", color: "#888" };
const tdStyle: React.CSSProperties = { padding: "0.6rem 0.9rem", borderBottom: "1px solid #f3f3f3", fontSize: "0.9rem" };

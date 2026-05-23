import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RecipientsList() {
  const supabase = supabaseServer();
  const { data: recipients } = await supabase
    .from("recipients")
    .select("id, approved_amount, reimbursement_rate, status, created_at, applications!inner(app_ref, parent_names, city)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", marginBottom: "1.5rem" }}>Recipients</h1>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Family</th>
            <th style={thStyle}>City</th>
            <th style={thStyle}>Cap</th>
            <th style={thStyle}>Rate</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Approved</th>
          </tr>
        </thead>
        <tbody>
          {(recipients || []).map((r: any) => (
            <tr key={r.id}>
              <td style={tdStyle}>
                <Link href={`/admin/recipients/${r.id}`} style={{ color: "var(--accent)" }}>
                  {r.applications.parent_names}
                </Link>
              </td>
              <td style={tdStyle}>{r.applications.city}</td>
              <td style={tdStyle}>${Number(r.approved_amount).toFixed(2)}</td>
              <td style={tdStyle}>{(Number(r.reimbursement_rate) * 100).toFixed(0)}%</td>
              <td style={tdStyle}>{r.status}</td>
              <td style={tdStyle}>{new Date(r.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {(!recipients || recipients.length === 0) && (
            <tr><td colSpan={6} style={{ ...tdStyle, color: "#888", textAlign: "center" }}>No recipients yet — approve an application to create one.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", background: "white", border: "1px solid #e5e5e5", borderRadius: 8, overflow: "hidden" };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "0.6rem 0.9rem", borderBottom: "1px solid #eee", fontSize: "0.78rem", textTransform: "uppercase", color: "#888", letterSpacing: "0.08em" };
const tdStyle: React.CSSProperties = { padding: "0.6rem 0.9rem", borderBottom: "1px solid #f3f3f3", fontSize: "0.9rem" };

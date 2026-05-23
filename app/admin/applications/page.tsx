import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ApplicationsList() {
  const supabase = supabaseServer();
  const { data: apps } = await supabase
    .from("applications")
    .select("id, app_ref, parent_names, city, status, created_at, children")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", marginBottom: "1.5rem" }}>Applications</h1>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Ref</th>
            <th style={thStyle}>Family</th>
            <th style={thStyle}>City</th>
            <th style={thStyle}>Kids</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {(apps || []).map((a: any) => (
            <tr key={a.id}>
              <td style={tdStyle}>
                <Link href={`/admin/applications/${a.id}`} style={{ color: "var(--accent)" }}>
                  {a.app_ref}
                </Link>
              </td>
              <td style={tdStyle}>{a.parent_names}</td>
              <td style={tdStyle}>{a.city}</td>
              <td style={tdStyle}>{Array.isArray(a.children) ? a.children.length : 0}</td>
              <td style={tdStyle}><StatusBadge s={a.status} /></td>
              <td style={tdStyle}>{new Date(a.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {(!apps || apps.length === 0) && (
            <tr><td colSpan={6} style={{ ...tdStyle, color: "#888", textAlign: "center" }}>No applications yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const color = s === "approved" ? "#3a9e6e" : s === "denied" ? "#e05050" : "#999";
  return <span style={{ background: color + "22", color, padding: "2px 8px", borderRadius: 4, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s}</span>;
}

const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", background: "white", border: "1px solid #e5e5e5", borderRadius: 8, overflow: "hidden" };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "0.6rem 0.9rem", borderBottom: "1px solid #eee", fontSize: "0.78rem", textTransform: "uppercase", color: "#888", letterSpacing: "0.08em" };
const tdStyle: React.CSSProperties = { padding: "0.6rem 0.9rem", borderBottom: "1px solid #f3f3f3", fontSize: "0.9rem" };

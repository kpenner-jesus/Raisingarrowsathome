import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const supabase = supabaseServer();
  const [pendingApps, activeRecipients, pendingReceipts, draftBatches] = await Promise.all([
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("recipients").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("receipts").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("payout_batches").select("*", { count: "exact", head: true }).eq("status", "draft"),
  ]);

  const stats = [
    { label: "Pending applications", value: pendingApps.count ?? 0,      href: "/admin/applications" },
    { label: "Active recipients",    value: activeRecipients.count ?? 0, href: "/admin/recipients" },
    { label: "Receipts to review",   value: pendingReceipts.count ?? 0,  href: "/admin/recipients" },
    { label: "Draft payout batches", value: draftBatches.count ?? 0,     href: "/admin/payouts" },
  ];

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", marginBottom: "1.5rem" }}>Dashboard</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: "1rem" }}>
        {stats.map((s) => (
          <Link key={s.label} href={s.href} style={cardStyle}>
            <div style={{ fontSize: "0.72rem", color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
              {s.label}
            </div>
            <div style={{ fontSize: "2.2rem", fontWeight: 600, fontFamily: "var(--font-display)" }}>
              {s.value}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  display: "block",
  background: "white",
  border: "1px solid #e5e5e5",
  borderRadius: 12,
  padding: "1.25rem 1.5rem",
  textDecoration: "none",
  color: "inherit",
};

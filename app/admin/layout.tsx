import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "220px 1fr" }}>
      <aside style={{ background: "#1a1a1a", color: "#fff", padding: "1.5rem 1rem", display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1.2rem", marginBottom: "1.5rem" }}>
          Raising Arrows
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.9rem" }}>
          <Link href="/admin"              style={navStyle}>Dashboard</Link>
          <Link href="/admin/applications" style={navStyle}>Applications</Link>
          <Link href="/admin/recipients"   style={navStyle}>Recipients</Link>
          <Link href="/admin/payouts"      style={navStyle}>Payouts</Link>
        </nav>
        <form action="/auth/logout" method="post" style={{ marginTop: "auto", paddingTop: "2rem" }}>
          <div style={{ fontSize: "0.7rem", color: "#888", marginBottom: "0.5rem", wordBreak: "break-all" }}>{user?.email}</div>
          <button type="submit" style={{ ...navStyle, background: "transparent", border: "1px solid #444", cursor: "pointer", width: "100%", textAlign: "left", fontFamily: "var(--font-body)" }}>
            Sign out
          </button>
        </form>
      </aside>
      <main style={{ padding: "2rem 2.5rem", background: "#fafafa" }}>{children}</main>
    </div>
  );
}

const navStyle: React.CSSProperties = {
  display: "block",
  padding: "0.5rem 0.75rem",
  borderRadius: 6,
  color: "#ddd",
  textDecoration: "none",
  fontFamily: "var(--font-body)",
};

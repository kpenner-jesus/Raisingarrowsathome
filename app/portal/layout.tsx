import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)" }}>
      <header style={{
        background: "rgba(255,255,255,0.7)",
        borderBottom: "1px solid rgba(0,0,0,0.08)",
        padding: "1rem 1.5rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.75rem",
      }}>
        <Link href="/" style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "1.2rem", color: "var(--text-primary)", textDecoration: "none" }}>
          Raising Arrows
        </Link>
        <nav style={{ display: "flex", gap: "1.25rem", alignItems: "center", fontSize: "0.9rem", flexWrap: "wrap" }}>
          <Link href="/portal"               style={navLink}>Dashboard</Link>
          <Link href="/portal/receipts/new"  style={navLink}>Upload receipt</Link>
          <Link href="/portal/photos"        style={navLink}>Photos</Link>
          <Link href="/portal/testimonials"  style={navLink}>Testimonials</Link>
          <Link href="/portal/help"          style={navLink}>Help</Link>
          <form action="/auth/logout" method="post" style={{ display: "inline" }}>
            <button type="submit" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem", fontFamily: "var(--font-body)" }}>
              Sign out · {user?.email}
            </button>
          </form>
        </nav>
      </header>
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "2.5rem 1.5rem" }}>
        {children}
      </main>
    </div>
  );
}

const navLink: React.CSSProperties = { color: "var(--text-primary)", textDecoration: "none", fontWeight: 500 };

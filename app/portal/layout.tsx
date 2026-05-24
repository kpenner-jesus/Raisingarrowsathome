import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";
import { MobileNavShell, Icons } from "@/app/_components/MobileNav";
import { PortalLogoutLink } from "./_PortalLogoutLink";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)" }}>
      {/* ───── Desktop horizontal header (hidden on mobile via .ra-portal-header) ───── */}
      <header
        className="ra-portal-header"
        style={{
          background: "rgba(255,255,255,0.7)",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
          padding: "1rem 1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "1.2rem",
            color: "var(--text-primary)",
            textDecoration: "none",
          }}
        >
          Raising Arrows
        </Link>
        <nav
          style={{
            display: "flex",
            gap: "1.25rem",
            alignItems: "center",
            fontSize: "0.9rem",
            flexWrap: "wrap",
          }}
        >
          <Link href="/portal" style={navLink}>Dashboard</Link>
          <Link href="/portal/receipts/new" style={navLink}>Upload receipt</Link>
          <Link href="/portal/receipts/batch" style={navLink}>Batch upload</Link>
          <Link href="/portal/photos" style={navLink}>Photos</Link>
          <Link href="/portal/testimonials" style={navLink}>Testimonials</Link>
          <Link href="/portal/statement" style={navLink}>Statement</Link>
          <Link href="/portal/profile" style={navLink}>Profile</Link>
          <Link href="/portal/help" style={navLink}>Help</Link>
          <form action="/auth/logout" method="post" style={{ display: "inline" }}>
            <button
              type="submit"
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontFamily: "var(--font-body)",
              }}
            >
              Sign out · {user?.email}
            </button>
          </form>
        </nav>
      </header>

      {/* ───── Mobile-only top app bar + drawer + bottom tab bar ───── */}
      <MobileNavShell
        brand="Raising Arrows"
        drawerTitle="Your portal"
        drawerItems={[
          { href: "/portal",                label: "Dashboard",      glyph: "◇" },
          { href: "/portal/receipts/new",   label: "Upload receipt", glyph: "↑" },
          { href: "/portal/receipts/batch", label: "Batch upload",   glyph: "≡" },
          { href: "/portal/photos",         label: "Photos",         glyph: "▢" },
          { href: "/portal/testimonials",   label: "Testimonials",   glyph: "”" },
          { href: "/portal/statement",      label: "Statement",      glyph: "§" },
          { href: "/portal/profile",        label: "Profile",        glyph: "◉" },
          { href: "/portal/help",           label: "Help",           glyph: "?" },
        ]}
        drawerFooter={
          <>
            <div className="em">Signed in as<br /><strong style={{ color: "var(--text-primary)" }}>{user?.email}</strong></div>
            <PortalLogoutLink />
          </>
        }
        tabItems={[
          { href: "/portal",           label: "Home",      icon: Icons.home },
          { href: "/portal/statement", label: "Statement", icon: Icons.doc },
          { href: "/portal/photos",    label: "Photos",    icon: Icons.photos },
          { href: "/portal/help",      label: "Help",      icon: Icons.help },
        ]}
      />

      <main
        className="ra-portal-main"
        style={{ maxWidth: 800, margin: "0 auto", padding: "2.5rem 1.5rem" }}
      >
        {children}
      </main>
    </div>
  );
}

const navLink: React.CSSProperties = {
  color: "var(--text-primary)",
  textDecoration: "none",
  fontWeight: 500,
};

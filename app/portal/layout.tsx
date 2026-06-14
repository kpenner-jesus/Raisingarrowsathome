import Link from "next/link";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { MobileNavShell } from "@/app/_components/MobileNav";
import { PortalLogoutLink } from "./_PortalLogoutLink";
import { ImpersonationBanner } from "./_components/ImpersonationBanner";
import { getOrgContext } from "@/app/lib/org-context";
import { isTenantAccessBlocked } from "@/app/lib/tenant-access";
import { aiReady } from "@/app/lib/ai/anthropic";
import { PortalChat } from "./_components/PortalChat";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  // Tenant-status gate: blocked-status tenants (paused/canceled/unpaid/
  // incomplete/unknown) get a maintenance page unless the caller is a
  // platform super_admin (for support work).
  const orgCtx = await getOrgContext();
  if (orgCtx && isTenantAccessBlocked(orgCtx.status)) {
    let isSuper = false;
    if (user) {
      const svc = supabaseService();
      const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
      isSuper = profile?.role === "super_admin";
    }
    if (!isSuper) {
      return (
        <div style={{ minHeight: "100vh", background: "var(--bg-gradient)", display: "grid", placeItems: "center", padding: "2rem 1.5rem", textAlign: "center" }}>
          <div style={{ maxWidth: 480 }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", marginBottom: "0.75rem" }}>{orgCtx.name} is offline</h1>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>
              This portal is temporarily paused. If you have questions about your grant,
              {orgCtx.sender_email
                ? <> please email <a href={`mailto:${orgCtx.sender_email}`} style={{ color: "var(--accent)" }}>{orgCtx.sender_email}</a>.</>
                : <> please contact your program administrator.</>}
            </p>
          </div>
        </div>
      );
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)" }}>
      {/* Sticky banner shown only when an admin is impersonating the test grantee */}
      <ImpersonationBanner />

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
          { href: "/portal",           label: "Home",      icon: "home" },
          { href: "/portal/statement", label: "Statement", icon: "doc" },
          { href: "/portal/photos",    label: "Photos",    icon: "photos" },
          { href: "/portal/help",      label: "Help",      icon: "help" },
        ]}
      />

      <main
        className="ra-portal-main"
        style={{ maxWidth: 800, margin: "0 auto", padding: "2.5rem 1.5rem" }}
      >
        {children}
      </main>

      {/* Read-only grant-help assistant — only when configured + signed in. */}
      {user && aiReady().ready && <PortalChat />}
    </div>
  );
}

const navLink: React.CSSProperties = {
  color: "var(--text-primary)",
  textDecoration: "none",
  fontWeight: 500,
};

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { NavLink } from "./_components/NavLink";
import { AdminProviders } from "./_components/AdminProviders";
import { MobileNavShell } from "@/app/_components/MobileNav";
import { AdminLogoutLink } from "./_components/AdminLogoutLink";
import { ImpersonateButton } from "./_components/ImpersonateButton";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect("/auth/login?next=%2Fadmin");
  }

  // Role lookup via service role — avoids RLS edge cases.
  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    redirect("/portal");
  }
  const isSuper = profile?.role === "super_admin";

  // Drawer items: full nav (mirrors sidebar). Includes super-admin gated items.
  const drawerItems = [
    { href: "/admin",                 label: "Dashboard",    glyph: "◇" },
    { href: "/admin/search",          label: "Search",       glyph: "⌕" },
    { href: "/admin/applications",    label: "Applications", glyph: "✎" },
    { href: "/admin/recipients",      label: "Recipients",   glyph: "❀" },
    { href: "/admin/payouts",         label: "Payouts",      glyph: "$" },
    { href: "/admin/photos",          label: "Photos",       glyph: "▢" },
    { href: "/admin/testimonials",    label: "Testimonials", glyph: "”" },
    { href: "/admin/reports",         label: "Reports",      glyph: "≡" },
    { href: "/admin/broadcasts",      label: "Broadcasts",   glyph: "✉" },
    { href: "/admin/emails",          label: "Email log",    glyph: "⇄" },
    { href: "/admin/email-templates", label: "Templates",    glyph: "◫" },
    { href: "/admin/categories",      label: "Categories",   glyph: "⌗" },
    { href: "/admin/audit-log",       label: "Audit log",    glyph: "⌖" },
    { href: "/admin/settings",        label: "Settings",     glyph: "⚙" },
    ...(isSuper ? [{ href: "/admin/team", label: "Team", glyph: "◉" }] : []),
    { href: "/admin/mcp",             label: "AI / MCP",     glyph: "✦" },
    { href: "/admin/help",            label: "Help",         glyph: "?" },
  ];

  return (
    <AdminProviders>
      {/* Mobile chrome lives OUTSIDE the grid so its sticky/fixed children
          don't become grid items. Hidden on desktop via mobile.css. */}
      <MobileNavShell
        brand="Raising Arrows"
        drawerTitle={isSuper ? "Super-admin" : "Admin"}
        drawerItems={drawerItems}
        drawerFooter={
          <>
            <div className="em">Signed in as<br /><strong style={{ color: "var(--text-primary)" }}>{user?.email}</strong></div>
            <AdminLogoutLink />
          </>
        }
        tabItems={[
          { href: "/admin",              label: "Dashboard", icon: "home" },
          { href: "/admin/applications", label: "Apps",      icon: "apps" },
          { href: "/admin/recipients",   label: "Families",  icon: "users" },
          { href: "/admin/payouts",      label: "Payouts",   icon: "cash" },
        ]}
      />

      <div className="ra-admin ra-admin-shell">
        <aside className="ra-admin-sidebar">
          <Link href="/" className="ra-admin-brand" title="Open public website">
            <div className="ra-admin-brand-name">
              Raising <em style={{ color: "var(--ra-accent)" }}>Arrows</em>
            </div>
            <div className="ra-admin-brand-sub">
              {isSuper ? "Super-admin" : "Admin"} · view site →
            </div>
          </Link>

          <nav className="ra-admin-nav">
            <NavLink href="/admin"                 label="Dashboard"    icon="◇" />
            <NavLink href="/admin/search"          label="Search"       icon="⌕" />
            <NavLink href="/admin/applications"    label="Applications" icon="✎" />
            <NavLink href="/admin/recipients"      label="Recipients"   icon="❀" />
            <NavLink href="/admin/payouts"         label="Payouts"      icon="$" />
            <NavLink href="/admin/photos"          label="Photos"       icon="▢" />
            <NavLink href="/admin/testimonials"    label="Testimonials" icon="”" />
            <NavLink href="/admin/reports"         label="Reports"      icon="≡" />
            <NavLink href="/admin/broadcasts"      label="Broadcasts"   icon="✉" />
            <NavLink href="/admin/emails"          label="Email log"    icon="⇄" />
            <NavLink href="/admin/email-templates" label="Templates"    icon="◫" />
            <NavLink href="/admin/categories"      label="Categories"   icon="⌗" />
            <NavLink href="/admin/audit-log"       label="Audit log"    icon="⌖" />
            <NavLink href="/admin/settings"        label="Settings"     icon="⚙" />
            {isSuper && <NavLink href="/admin/team" label="Team"        icon="◉" />}
            <NavLink href="/admin/mcp"             label="AI / MCP"     icon="✦" />
            <NavLink href="/admin/help"            label="Help"         icon="?" />
          </nav>

          {/* Impersonation toggle for non-prod deploys */}
          <div style={{ padding: "0.5rem 0 1rem", borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: "auto" }}>
            <ImpersonateButton variant="sidebar" />
          </div>
          <form action="/auth/logout" method="post" className="ra-admin-signout">
            <div className="ra-admin-signout-email">{user?.email}</div>
            <button type="submit" className="ra-admin-signout-btn">Sign out</button>
          </form>
        </aside>

        <main className="ra-admin-main">
          {children}
        </main>
      </div>
    </AdminProviders>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { NavLink } from "./_components/NavLink";
import { AdminProviders } from "./_components/AdminProviders";
import { MobileNavShell } from "@/app/_components/MobileNav";
import { AdminLogoutLink } from "./_components/AdminLogoutLink";
import { ImpersonateButton } from "./_components/ImpersonateButton";
import { getOrgContext, orgPath } from "@/app/lib/org-context";
import { aiReady } from "@/app/lib/ai/anthropic";
import { AdminChat } from "./_components/AdminChat";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Resolve the tenant BEFORE the session check, so a signed-out admin is
  // sent back to THEIR org's admin. This hardcoded next=%2Fadmin, and bare
  // /admin resolves by Host — so a path-routed tenant signed in, landed on the
  // host-default org they aren't a member of, and was bounced to the portal.
  const orgCtx = await getOrgContext();

  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/auth/login?next=${encodeURIComponent(orgPath(orgCtx, "/admin"))}`);
  }

  if (!orgCtx) {
    // No org resolved — bare admin URL on an unknown host. Send to signup
    // which can either route to their org or create a new one.
    redirect("/signup");
  }

  // Membership lookup for this user within this tenant.
  const svc = supabaseService();
  const { data: membership } = await svc
    .from("org_members")
    .select("role")
    .eq("org_id", orgCtx.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const orgRole = membership?.role;
  const isOwner = orgRole === "owner";
  const isAdmin = isOwner || orgRole === "admin";

  // Also let the user through if they're a platform super-admin (you, for support).
  const { data: profile } = await svc.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const isPlatformSuper = profile?.role === "super_admin";

  if (!isAdmin && !isPlatformSuper) {
    redirect(orgPath(orgCtx, "/portal"));
  }
  // NOTE: admin READS stay open for blocked-status tenants by design — the
  // owner must be able to view their own data + reach Settings → Billing to
  // pay/reactivate. WRITES are blocked via requireAdmin() (423) on every
  // mutation route, which is the actual leverage while delinquent.
  const isSuper = isOwner || isPlatformSuper;

  // Helper: wrap path with /o/<slug>/ prefix when accessed via path-routed host
  const op = (p: string) => orgPath(orgCtx, p);

  // Drawer items: full nav (mirrors sidebar). Includes super-admin gated items.
  const drawerItems = [
    { href: op("/admin"),                 label: "Dashboard",    glyph: "◇" },
    { href: op("/admin/search"),          label: "Search",       glyph: "⌕" },
    { href: op("/admin/applications"),    label: "Applications", glyph: "✎" },
    { href: op("/admin/recipients"),      label: "Recipients",   glyph: "❀" },
    { href: op("/admin/payouts"),         label: "Payouts",      glyph: "$" },
    { href: op("/admin/photos"),          label: "Photos",       glyph: "▢" },
    { href: op("/admin/testimonials"),    label: "Testimonials", glyph: "”" },
    { href: op("/admin/reports"),         label: "Reports",      glyph: "≡" },
    { href: op("/admin/broadcasts"),      label: "Broadcasts",   glyph: "✉" },
    { href: op("/admin/emails"),          label: "Email log",    glyph: "⇄" },
    { href: op("/admin/email-templates"), label: "Templates",    glyph: "◫" },
    { href: op("/admin/categories"),      label: "Categories",   glyph: "⌗" },
    { href: op("/admin/audit-log"),       label: "Audit log",    glyph: "⌖" },
    { href: op("/admin/settings"),        label: "Settings",     glyph: "⚙" },
    ...(isSuper ? [{ href: op("/admin/team"), label: "Team", glyph: "◉" }] : []),
    { href: op("/admin/mcp"),             label: "AI / MCP",     glyph: "✦" },
    { href: op("/admin/help"),            label: "Help",         glyph: "?" },
  ];

  return (
    <AdminProviders>
      {/* Mobile chrome lives OUTSIDE the grid so its sticky/fixed children
          don't become grid items. Hidden on desktop via mobile.css. */}
      <MobileNavShell
        brand={orgCtx.name}
        drawerTitle={isSuper ? "Super-admin" : "Admin"}
        drawerItems={drawerItems}
        drawerFooter={
          <>
            <div className="em">Signed in as<br /><strong style={{ color: "var(--text-primary)" }}>{user?.email}</strong></div>
            <AdminLogoutLink />
          </>
        }
        tabItems={[
          { href: op("/admin"),              label: "Dashboard", icon: "home" },
          { href: op("/admin/applications"), label: "Apps",      icon: "apps" },
          { href: op("/admin/recipients"),   label: "Families",  icon: "users" },
          { href: op("/admin/payouts"),      label: "Payouts",   icon: "cash" },
        ]}
      />

      <div className="ra-admin ra-admin-shell">
        <aside className="ra-admin-sidebar">
          <Link href="/" className="ra-admin-brand" title="Open public website">
            <div className="ra-admin-brand-name">
              {orgCtx.name}
            </div>
            <div className="ra-admin-brand-sub">
              {isSuper ? "Super-admin" : "Admin"} · view site →
            </div>
          </Link>

          <nav className="ra-admin-nav">
            <NavLink href={op("/admin")}                 label="Dashboard"    icon="◇" />
            <NavLink href={op("/admin/search")}          label="Search"       icon="⌕" />
            <NavLink href={op("/admin/applications")}    label="Applications" icon="✎" />
            <NavLink href={op("/admin/recipients")}      label="Recipients"   icon="❀" />
            <NavLink href={op("/admin/payouts")}         label="Payouts"      icon="$" />
            <NavLink href={op("/admin/photos")}          label="Photos"       icon="▢" />
            <NavLink href={op("/admin/testimonials")}    label="Testimonials" icon="”" />
            <NavLink href={op("/admin/reports")}         label="Reports"      icon="≡" />
            <NavLink href={op("/admin/broadcasts")}      label="Broadcasts"   icon="✉" />
            <NavLink href={op("/admin/emails")}          label="Email log"    icon="⇄" />
            <NavLink href={op("/admin/email-templates")} label="Templates"    icon="◫" />
            <NavLink href={op("/admin/categories")}      label="Categories"   icon="⌗" />
            <NavLink href={op("/admin/audit-log")}       label="Audit log"    icon="⌖" />
            <NavLink href={op("/admin/settings")}        label="Settings"     icon="⚙" />
            {isSuper && <NavLink href={op("/admin/team")} label="Team"        icon="◉" />}
            <NavLink href={op("/admin/mcp")}             label="AI / MCP"     icon="✦" />
            <NavLink href={op("/admin/help")}            label="Help"         icon="?" />
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

      {/* Operator AI assistant — only when an Anthropic key is configured. */}
      {aiReady().ready && <AdminChat />}
    </AdminProviders>
  );
}

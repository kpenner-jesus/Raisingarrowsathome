import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { NavLink } from "./_components/NavLink";
import { AdminProviders } from "./_components/AdminProviders";
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

  return (
    <AdminProviders>
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
            <NavLink href="/admin"               label="Dashboard"    icon="◇" />
            <NavLink href="/admin/applications"  label="Applications" icon="✎" />
            <NavLink href="/admin/recipients"    label="Recipients"   icon="❀" />
            <NavLink href="/admin/payouts"       label="Payouts"      icon="$" />
            <NavLink href="/admin/testimonials"  label="Testimonials" icon="”" />
            <NavLink href="/admin/reports"       label="Reports"      icon="≡" />
            <NavLink href="/admin/audit-log"     label="Audit log"    icon="⌖" />
            <NavLink href="/admin/settings"      label="Settings"     icon="⚙" />
            {isSuper && <NavLink href="/admin/team" label="Team"      icon="◉" />}
            <NavLink href="/admin/mcp"           label="AI / MCP"     icon="✦" />
            <NavLink href="/admin/help"          label="Help"         icon="?" />
          </nav>

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

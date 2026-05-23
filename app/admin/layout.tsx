import { supabaseServer } from "@/app/lib/supabase/server";
import { NavLink } from "./_components/NavLink";
import { AdminProviders } from "./_components/AdminProviders";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isSuper = profile?.role === "super_admin";

  return (
    <AdminProviders>
      <div className="ra-admin" style={{ display: "grid", gridTemplateColumns: "232px 1fr", minHeight: "100vh" }}>
        <aside
          style={{
            background: "linear-gradient(165deg, #1e1715 0%, #100b0a 100%)",
            color: "#fff",
            padding: "1.5rem 0.9rem",
            display: "flex",
            flexDirection: "column",
            position: "sticky",
            top: 0,
            height: "100vh",
            borderRight: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div style={{
            padding: "0 0.5rem 1.5rem",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            marginBottom: "1.25rem",
          }}>
            <div style={{
              fontFamily: "var(--font-display)", fontStyle: "italic",
              fontSize: "1.35rem", letterSpacing: "-0.01em", lineHeight: 1.1,
            }}>
              Raising <em style={{ color: "var(--ra-accent)" }}>Arrows</em>
            </div>
            <div style={{
              fontSize: "0.7rem", letterSpacing: "0.15em", textTransform: "uppercase",
              color: "rgba(255,255,255,0.45)", marginTop: "0.35rem", fontWeight: 500,
            }}>
              {isSuper ? "Super-admin" : "Admin"}
            </div>
          </div>

          <nav style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
            <NavLink href="/admin"              label="Dashboard"    icon="◇" />
            <NavLink href="/admin/applications" label="Applications" icon="✎" />
            <NavLink href="/admin/recipients"   label="Recipients"   icon="❀" />
            <NavLink href="/admin/payouts"      label="Payouts"      icon="$" />
            {isSuper && <NavLink href="/admin/team" label="Team" icon="◉" />}
            <NavLink href="/admin/help"         label="Help"         icon="?" />
          </nav>

          <form action="/auth/logout" method="post" style={{ marginTop: "auto", paddingTop: "1.5rem" }}>
            <div style={{
              fontSize: "0.7rem", color: "rgba(255,255,255,0.4)", marginBottom: "0.5rem", padding: "0 0.5rem",
              letterSpacing: "0.05em", wordBreak: "break-all",
            }}>
              {user?.email}
            </div>
            <button type="submit" style={{
              width: "100%", textAlign: "left", padding: "0.5rem 0.85rem",
              background: "transparent", border: "1px solid rgba(255,255,255,0.14)",
              color: "rgba(255,255,255,0.7)", fontFamily: "var(--font-body)",
              fontSize: "0.85rem", borderRadius: 8, cursor: "pointer",
              transition: "background 0.15s, color 0.15s",
            }}>
              Sign out
            </button>
          </form>
        </aside>
        <main style={{ padding: "2rem 2.5rem 4rem" }}>
          {children}
        </main>
      </div>
    </AdminProviders>
  );
}

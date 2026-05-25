// /platform — global operator dashboard. Only profiles.role='super_admin'
// users can access. Lets Kevin oversee every tenant, their billing,
// pause/refund/impersonate, etc.
//
// Auth model differs from /admin (which is per-tenant): here we check
// the platform-level profiles.role only. There's no tenant context.

import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login?next=%2Fplatform");

  const svc = supabaseService();
  const { data: profile } = await svc.from("profiles")
    .select("role, email").eq("id", user.id).maybeSingle();
  if (profile?.role !== "super_admin") {
    redirect("/admin");
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #1a1612 0%, #2a221c 100%)", color: "#fff" }}>
      <header style={{
        padding: "1rem 1.5rem",
        background: "rgba(0,0,0,0.25)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.75rem",
      }}>
        <div>
          <div style={{ fontFamily: "Georgia, 'Playfair Display', serif", fontStyle: "italic", fontSize: "1.3rem", color: "#e8793a" }}>
            Raising Arrows Platform
          </div>
          <div style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", fontWeight: 600, marginTop: "0.2rem" }}>
            Super-admin · global operator view
          </div>
        </div>
        <nav style={{ display: "flex", gap: "1rem", alignItems: "center", fontSize: "0.9rem", fontWeight: 500 }}>
          <Link href="/platform" style={{ color: "#fff", textDecoration: "none", opacity: 0.85 }}>Tenants</Link>
          <Link href="/admin" style={{ color: "#fff", textDecoration: "none", opacity: 0.7 }}>← Back to admin</Link>
          <form action="/auth/logout" method="post" style={{ display: "inline" }}>
            <button type="submit" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "0.85rem" }}>
              Sign out · {profile?.email}
            </button>
          </form>
        </nav>
      </header>
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem 1.5rem" }}>
        {children}
      </main>
    </div>
  );
}

import { notFound } from "next/navigation";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { StatusBadge } from "../_components/StatusBadge";
import { SortHeader } from "../_components/SortHeader";
import TeamRow from "./TeamRow";
import InviteForm from "./InviteForm";

export const dynamic = "force-dynamic";

export default async function TeamPage({ searchParams }: { searchParams?: { sort?: string; dir?: string } }) {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return notFound();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return notFound();

  const VALID = ["role", "email", "created"] as const;
  type Col = typeof VALID[number];
  const SORT_MAP: Record<Col, string> = { role: "role", email: "email", created: "created_at" };
  const sortRaw = (searchParams?.sort ?? "role") as Col;
  const sortCol: Col = (VALID as readonly string[]).includes(sortRaw) ? sortRaw : "role";
  const dir: "asc" | "desc" = searchParams?.dir === "asc" ? "asc" : "desc";

  const service = supabaseService();
  const { data: team } = await service
    .from("profiles")
    .select("id, email, role, created_at")
    .in("role", ["admin", "super_admin"])
    .order(SORT_MAP[sortCol], { ascending: dir === "asc" });

  const { data: list } = await service.auth.admin.listUsers();
  const lastSignIn: Record<string, string | null> = {};
  list?.users.forEach((u) => { lastSignIn[u.id] = u.last_sign_in_at ?? null; });

  // Recent audit log (last 10 entries on team actions)
  const { data: audit } = await service
    .from("audit_log")
    .select("id, actor_id, action, target_id, details, created_at, profiles:profiles!actor_id(email)")
    .like("action", "team.%")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Super-admin only</span>
          <h1 className="ra-h1">Team</h1>
          <p className="ra-quiet">Manage who can sign in to the admin area. You are <strong>{user.email}</strong>.</p>
        </div>
      </header>

      <section className="ra-card" style={{ marginBottom: "1.5rem" }}>
        <h3 className="ra-section-title">Invite admin</h3>
        <InviteForm />
      </section>

      <div className="ra-table-card" style={{ marginBottom: "1.5rem" }}>
        <table className="ra-table">
          <thead>
            <tr>
              <SortHeader label="Email"   col="email"   currentSort={sortCol} currentDir={dir} basePath="/admin/team" />
              <SortHeader label="Role"    col="role"    currentSort={sortCol} currentDir={dir} basePath="/admin/team" />
              <SortHeader label="Joined"  col="created" currentSort={sortCol} currentDir={dir} basePath="/admin/team" />
              <th>Last sign-in</th>
              <th style={{ textAlign: "right" }}></th>
            </tr>
          </thead>
          <tbody>
            {(team || []).map((m: any) => (
              <TeamRow
                key={m.id}
                member={{
                  id:               m.id,
                  email:            m.email,
                  role:             m.role,
                  created_at:       m.created_at,
                  last_sign_in_at:  lastSignIn[m.id] ?? null,
                }}
                isSelf={m.id === user.id}
              />
            ))}
            {(!team || team.length === 0) && (
              <tr><td colSpan={5} className="ra-empty">No team members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="ra-card">
        <h3 className="ra-section-title">Recent team activity</h3>
        {audit && audit.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {audit.map((a: any) => (
              <li key={a.id} className="ra-row-between" style={{ fontSize: "0.88rem", padding: "0.5rem 0", borderTop: "1px solid var(--ra-line)" }}>
                <span>
                  <span style={{ fontWeight: 500 }}>{a.profiles?.email || "system"}</span>{" "}
                  <span className="ra-quiet">
                    {a.action === "team.invite"      && `invited ${a.details?.email} as ${a.details?.role}`}
                    {a.action === "team.role_change" && `changed ${a.details?.email}'s role from ${a.details?.from} to ${a.details?.to}`}
                    {a.action === "team.revoke"     && `revoked admin from ${a.details?.email} (was ${a.details?.was})`}
                  </span>
                </span>
                <span className="ra-tiny">{new Date(a.created_at).toLocaleString("en-CA")}</span>
              </li>
            ))}
          </ul>
        ) : <div className="ra-quiet">No team changes yet.</div>}
      </section>
    </div>
  );
}

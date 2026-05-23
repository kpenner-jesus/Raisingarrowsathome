import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";
import { AvatarRow } from "../_components/Avatar";
import { StatusBadge } from "../_components/StatusBadge";
import { ApplicationsFilter } from "./ApplicationsFilter";

export const dynamic = "force-dynamic";

interface SearchParams { status?: string; q?: string; }

export default async function ApplicationsList({ searchParams }: { searchParams: SearchParams }) {
  const supabase = supabaseServer();
  let q = supabase
    .from("applications")
    .select("id, app_ref, parent_names, city, contact_email, status, created_at, children, decided_at")
    .order("created_at", { ascending: false });

  if (searchParams.status && ["pending", "approved", "denied"].includes(searchParams.status)) {
    q = q.eq("status", searchParams.status);
  }
  if (searchParams.q) {
    // Sanitize search term:
    //  - escape PostgREST `.or()` separator (comma) so user can't inject extra predicates
    //  - escape ILIKE wildcards (%, _) so literal text doesn't match unintended rows
    //  - cap length to defend against absurd inputs
    const term = searchParams.q
      .slice(0, 100)
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
      .replace(/,/g, "")        // PostgREST .or() splits on commas
      .replace(/[()*]/g, "");   // strip PostgREST operator chars
    if (term) {
      q = q.or(`parent_names.ilike.%${term}%,city.ilike.%${term}%,app_ref.ilike.%${term}%`);
    }
  }
  const { data: apps } = await q;

  const counts = await Promise.all([
    supabase.from("applications").select("*", { count: "exact", head: true }),
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("status", "approved"),
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("status", "denied"),
  ]);

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">All families</span>
          <h1 className="ra-h1">Applications</h1>
          <p className="ra-quiet">Review and decide on incoming grant requests.</p>
        </div>
      </header>

      <ApplicationsFilter
        totals={{
          all:      counts[0].count ?? 0,
          pending:  counts[1].count ?? 0,
          approved: counts[2].count ?? 0,
          denied:   counts[3].count ?? 0,
        }}
      />

      <div className="ra-table-card" style={{ marginTop: "1rem" }}>
        <table className="ra-table">
          <thead>
            <tr>
              <th>Family</th>
              <th>Ref</th>
              <th>Kids</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {(apps || []).map((a: any) => {
              const kids = Array.isArray(a.children) ? a.children : [];
              return (
                <tr key={a.id}>
                  <td>
                    <Link href={`/admin/applications/${a.id}`}>
                      <AvatarRow name={a.parent_names} secondary={a.city + " · " + a.contact_email} />
                    </Link>
                  </td>
                  <td className="ra-tiny" style={{ fontFamily: "ui-monospace, monospace" }}>{a.app_ref}</td>
                  <td>
                    {kids.length > 0 ? (
                      <span className="ra-quiet">
                        {kids.length} · ages {kids.map((c: any) => c.age).join(", ")}
                      </span>
                    ) : <span className="ra-quiet">—</span>}
                  </td>
                  <td><StatusBadge status={a.status} /></td>
                  <td style={{ textAlign: "right" }} className="ra-tiny">
                    {new Date(a.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                </tr>
              );
            })}
            {(!apps || apps.length === 0) && (
              <tr>
                <td colSpan={5}>
                  <div className="ra-empty">
                    <div className="ra-empty-icon">✉</div>
                    <div className="ra-empty-title">No applications match</div>
                    <div>Try clearing filters or wait for new submissions.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

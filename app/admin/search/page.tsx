// /admin/search?q=...
// Searches across applications, recipients, and receipts by parent_names,
// contact_email, app_ref, or description. Returns top 20 per bucket.
import Link from "next/link";
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

function sanitize(raw: string): string {
  // Escape PostgREST .or() separator + ILIKE wildcards. Cap length.
  return raw.slice(0, 100)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, "")
    .replace(/[()*]/g, "")
    .trim();
}

export default async function SearchPage({ searchParams }: { searchParams?: { q?: string } }) {
  const raw = (searchParams?.q ?? "").trim();
  const q = sanitize(raw);
  const svc = supabaseService();

  const [apps, recs, receipts] = q.length === 0 ? [{ data: [] }, { data: [] }, { data: [] }] as any : await Promise.all([
    svc.from("applications").select("id, app_ref, parent_names, contact_email, city, status, created_at, archived_at")
      .or(`parent_names.ilike.%${q}%,contact_email.ilike.%${q}%,app_ref.ilike.%${q}%,city.ilike.%${q}%`)
      .order("created_at", { ascending: false }).limit(20),
    svc.from("recipients").select(`id, status, archived_at, created_at,
      applications!inner(parent_names, contact_email, app_ref, city)`)
      .or(`parent_names.ilike.%${q}%,contact_email.ilike.%${q}%,app_ref.ilike.%${q}%`, { foreignTable: "applications" })
      .order("created_at", { ascending: false }).limit(20),
    svc.from("receipts").select(`id, amount, currency, description, status, created_at,
      recipients!inner(id, applications!inner(parent_names, app_ref))`)
      .ilike("description", `%${q}%`)
      .order("created_at", { ascending: false }).limit(20),
  ]);

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Find anything</span>
          <h1 className="ra-h1">Search</h1>
        </div>
        <form method="get" style={{ display: "flex", gap: "0.5rem" }}>
          <input name="q" defaultValue={raw} placeholder="parent name, email, ref, description…" className="ra-input" style={{ minWidth: 300 }} autoFocus />
          <button type="submit" className="ra-btn ra-btn-primary">Search</button>
        </form>
      </header>

      {q.length === 0 ? (
        <div className="ra-card ra-empty">
          <div className="ra-empty-icon">⌕</div>
          <div className="ra-empty-title">Type a search term above</div>
          <div>Searches applications, recipients, and receipts.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <ResultSection title={`Applications (${apps.data?.length ?? 0})`}>
            {(apps.data?.length ?? 0) === 0 ? <div className="ra-quiet">No matches.</div> : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {(apps.data as any[]).map((a) => (
                  <li key={a.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--ra-line)" }}>
                    <Link href={`/admin/applications/${a.id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <strong>{a.parent_names}</strong>{" "}
                      <span className="ra-tiny">· {a.app_ref} · {a.city ?? "—"} · {a.status}</span>
                      {a.archived_at && <span className="ra-tiny" style={{ color: "var(--ra-danger)" }}> · archived</span>}
                      <div className="ra-tiny">{a.contact_email}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ResultSection>

          <ResultSection title={`Recipients (${recs.data?.length ?? 0})`}>
            {(recs.data?.length ?? 0) === 0 ? <div className="ra-quiet">No matches.</div> : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {(recs.data as any[]).map((r) => (
                  <li key={r.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--ra-line)" }}>
                    <Link href={`/admin/recipients/${r.id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <strong>{r.applications.parent_names}</strong>{" "}
                      <span className="ra-tiny">· {r.applications.app_ref} · {r.status}</span>
                      {r.archived_at && <span className="ra-tiny" style={{ color: "var(--ra-danger)" }}> · archived</span>}
                      <div className="ra-tiny">{r.applications.contact_email}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ResultSection>

          <ResultSection title={`Receipts (${receipts.data?.length ?? 0})`}>
            {(receipts.data?.length ?? 0) === 0 ? <div className="ra-quiet">No matches.</div> : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {(receipts.data as any[]).map((r) => (
                  <li key={r.id} style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--ra-line)" }}>
                    <Link href={`/admin/recipients/${r.recipients.id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <strong>{r.description || "Receipt"}</strong>{" "}
                      <span className="ra-tiny">· ${Number(r.amount).toFixed(2)} {r.currency || "CAD"} · {r.status}</span>
                      <div className="ra-tiny">{r.recipients.applications.parent_names} · {r.recipients.applications.app_ref}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ResultSection>
        </div>
      )}
    </div>
  );
}

function ResultSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ra-card">
      <h2 className="ra-section-title">{title}</h2>
      {children}
    </section>
  );
}

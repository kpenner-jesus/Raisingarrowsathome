// /admin/photos — gallery of every photo submitted across all recipients.
//   Cards link back to the recipient page for context.
//   Filter by recipient or year.
import Link from "next/link";
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PhotosPage({ searchParams }: {
  searchParams?: { recipient?: string; year?: string };
}) {
  const svc = supabaseService();

  let q = svc.from("photos").select(`
    id, image_path, caption, created_at, recipient_id,
    recipients!inner(id, applications!inner(parent_names, app_ref))
  `).order("created_at", { ascending: false }).limit(200);

  if (searchParams?.recipient) q = q.eq("recipient_id", searchParams.recipient);
  if (searchParams?.year && /^\d{4}$/.test(searchParams.year)) {
    const y = Number(searchParams.year);
    q = q.gte("created_at", `${y}-01-01T00:00:00Z`).lt("created_at", `${y + 1}-01-01T00:00:00Z`);
  }
  const { data: photos } = await q;

  const now = new Date().getUTCFullYear();
  const yearOptions: number[] = [];
  for (let y = now; y >= 2024; y--) yearOptions.push(y);

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Recipients in action</span>
          <h1 className="ra-h1">Photo gallery</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Up to 200 most recent submissions. Filter to a year for cohort highlights or pull marketing material.
          </p>
        </div>
        <form method="get" style={{ display: "flex", gap: "0.5rem", alignItems: "end" }}>
          <div>
            <label className="ra-label">Year</label>
            <select name="year" defaultValue={searchParams?.year ?? ""} className="ra-input">
              <option value="">All</option>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button type="submit" className="ra-btn">Apply</button>
        </form>
      </header>

      {(photos?.length ?? 0) === 0 ? (
        <div className="ra-card ra-empty">
          <div className="ra-empty-icon">▢</div>
          <div className="ra-empty-title">No photos yet</div>
          <div>When families upload, they will show up here.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.85rem" }}>
          {(photos ?? []).map((p: any) => {
            const fam = p.recipients?.applications?.parent_names ?? "(unknown)";
            return (
              <a
                key={p.id}
                href={`/api/admin/photo-image?id=${p.id}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "block", textDecoration: "none", color: "inherit",
                  background: "var(--ra-bg-soft)", borderRadius: 12,
                  overflow: "hidden", border: "1px solid var(--ra-line)",
                  boxShadow: "var(--ra-shadow-sm)",
                  transition: "transform 0.18s, box-shadow 0.18s",
                }}
                className="ra-photo-card"
              >
                <div style={{ width: "100%", aspectRatio: "1 / 1", background: "#f3f0eb", overflow: "hidden" }}>
                  <img src={`/api/admin/photo-image?id=${p.id}`} alt={p.caption || fam}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    loading="lazy" />
                </div>
                <div style={{ padding: "0.55rem 0.75rem" }}>
                  <div style={{ fontWeight: 500, fontSize: "0.85rem" }}>
                    <Link href={`/admin/recipients/${p.recipient_id}`} style={{ color: "var(--ra-ink)", textDecoration: "none" }}
                      onClick={(e) => e.stopPropagation()}>
                      {fam}
                    </Link>
                  </div>
                  {p.caption && <div className="ra-tiny" style={{ marginTop: "0.2rem", lineHeight: 1.35 }}>{p.caption}</div>}
                  <div className="ra-tiny" style={{ marginTop: "0.2rem", color: "var(--ra-ink-quiet)" }}>
                    {new Date(p.created_at).toLocaleDateString()}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

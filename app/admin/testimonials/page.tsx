// /admin/testimonials — review/approve/hide submitted testimonials.
import Link from "next/link";
import { supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext, orgPath } from "@/app/lib/org-context";
import { TestimonialManager } from "./TestimonialManager";

export const dynamic = "force-dynamic";

function sanitize(raw: string): string {
  return raw.slice(0, 100)
    .replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
    .replace(/,/g, "").replace(/[()*]/g, "").trim();
}

export default async function TestimonialsPage({ searchParams }: {
  searchParams?: { status?: string; q?: string; sort?: string; dir?: string };
}) {
  const ctx = await requireOrgContext();
  const svc = supabaseService();
  const status = searchParams?.status ?? "pending";
  const searchRaw = (searchParams?.q ?? "").trim();
  const term = sanitize(searchRaw);
  const dir: "asc" | "desc" = searchParams?.dir === "asc" ? "asc" : "desc";

  let q = svc.from("testimonials").select(`
    id, body, status, featured, created_at, reviewed_at,
    recipients!inner(applications!inner(parent_names, app_ref, city))
  `)
    .eq("org_id", ctx.id)
    .order("created_at", { ascending: dir === "asc" });

  if (status !== "all") q = q.eq("status", status);
  if (term) {
    // Search body OR family name (foreignTable for the join)
    q = q.or(`body.ilike.%${term}%`);
  }
  const { data } = await q;

  const counts: any = await Promise.all([
    svc.from("testimonials").select("id", { count: "exact", head: true }).eq("org_id", ctx.id).eq("status", "pending"),
    svc.from("testimonials").select("id", { count: "exact", head: true }).eq("org_id", ctx.id).eq("status", "approved"),
    svc.from("testimonials").select("id", { count: "exact", head: true }).eq("org_id", ctx.id).eq("status", "hidden"),
  ]);

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Voice of recipients</span>
          <h1 className="ra-h1">Testimonials</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Review family quotes. Approve to allow display, feature to highlight, hide to remove from rotation.
          </p>
        </div>
        <form method="get" style={{ display: "flex", gap: "0.5rem", alignItems: "end" }}>
          <div>
            <label className="ra-label">Search body</label>
            <input name="q" defaultValue={searchRaw} placeholder="text snippet…" className="ra-input" style={{ minWidth: 200 }} />
          </div>
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="dir" value={dir} />
          <button type="submit" className="ra-btn">Search</button>
          {term && <Link href={orgPath(ctx, `/admin/testimonials?status=${status}`)} className="ra-btn">Reset</Link>}
        </form>
      </header>

      <div className="ra-tabs" style={{ marginBottom: "1.25rem" }}>
        {(["pending","approved","hidden","all"] as const).map((s, i) => {
          const labels = { pending: "Pending", approved: "Approved", hidden: "Hidden", all: "All" } as const;
          const count = s === "all" ? null : counts[i]?.count ?? 0;
          const params = new URLSearchParams();
          params.set("status", s);
          if (term) params.set("q", searchRaw);
          if (dir === "asc") params.set("dir", "asc");
          return (
            <a key={s} href={orgPath(ctx, `/admin/testimonials?${params.toString()}`)}
              className={`ra-tab ${status === s ? "ra-tab-active" : ""}`}>
              {labels[s]}{count != null ? ` (${count})` : ""}
            </a>
          );
        })}
        <div style={{ flex: 1 }} />
        <a href={orgPath(ctx, `/admin/testimonials?status=${status}${term ? `&q=${encodeURIComponent(searchRaw)}` : ""}&dir=${dir === "asc" ? "desc" : "asc"}`)}
          className="ra-tab" title="Toggle date sort direction">
          Sort: date {dir === "asc" ? "↑" : "↓"}
        </a>
      </div>

      {term && (
        <div className="ra-quiet" style={{ marginBottom: "0.75rem", fontSize: "0.88rem" }}>
          Showing {data?.length ?? 0} match{(data?.length ?? 0) === 1 ? "" : "es"} for <strong>&ldquo;{searchRaw}&rdquo;</strong>
        </div>
      )}

      <TestimonialManager items={(data as any[] ?? []) as any} />
    </div>
  );
}

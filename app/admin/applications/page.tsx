import { supabaseServer } from "@/app/lib/supabase/server";
import { requireOrgContext } from "@/app/lib/org-context";
import { ApplicationsFilter } from "./ApplicationsFilter";
import { ApplicationsTable } from "./BulkActions";

export const dynamic = "force-dynamic";

interface SearchParams { status?: string; q?: string; sort?: string; dir?: string; }

const VALID_SORTS = ["family", "status", "created"] as const;
type SortCol = typeof VALID_SORTS[number];
const SORT_MAP: Record<SortCol, string> = {
  family:  "parent_names",
  status:  "status",
  created: "created_at",
};

export default async function ApplicationsList({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireOrgContext();
  const supabase = supabaseServer();

  const sortRaw = (searchParams.sort ?? "created") as SortCol;
  const sortCol: SortCol = (VALID_SORTS as readonly string[]).includes(sortRaw) ? sortRaw : "created";
  const dir: "asc" | "desc" = searchParams.dir === "asc" ? "asc" : "desc";

  let q = supabase
    .from("applications")
    .select("id, app_ref, parent_names, city, contact_email, status, created_at, children, decided_at")
    .eq("org_id", ctx.id)
    .order(SORT_MAP[sortCol], { ascending: dir === "asc" });

  if (searchParams.status && ["pending", "approved", "denied"].includes(searchParams.status)) {
    q = q.eq("status", searchParams.status);
  }
  if (searchParams.q) {
    const term = searchParams.q
      .slice(0, 100)
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
      .replace(/,/g, "")
      .replace(/[()*]/g, "");
    if (term) {
      q = q.or(`parent_names.ilike.%${term}%,city.ilike.%${term}%,app_ref.ilike.%${term}%`);
    }
  }
  const { data: apps } = await q;

  const counts = await Promise.all([
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("org_id", ctx.id),
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("org_id", ctx.id).eq("status", "pending"),
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("org_id", ctx.id).eq("status", "approved"),
    supabase.from("applications").select("*", { count: "exact", head: true }).eq("org_id", ctx.id).eq("status", "denied"),
  ]);

  const extra: Record<string, string | undefined> = {
    q: searchParams.q || undefined,
    status: searchParams.status || undefined,
  };

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

      <ApplicationsTable
        rows={(apps as any[]) ?? []}
        sort={{ col: sortCol, dir, extra }}
      />
    </div>
  );
}

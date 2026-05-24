import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";
import { AvatarRow } from "../_components/Avatar";
import { StatusBadge } from "../_components/StatusBadge";
import { ProgressBar } from "../_components/ProgressBar";
import { SortHeader } from "../_components/SortHeader";

export const dynamic = "force-dynamic";

type SortCol = "family" | "cap" | "status" | "approved" | "cohort";
const VALID_SORTS: SortCol[] = ["family", "cap", "status", "approved", "cohort"];

interface SearchParams {
  cohort?: string;
  status?: string;
  show?: string;
  q?: string;
  sort?: string;
  dir?: string;
}

function sanitizeSearch(raw: string): string {
  return raw.slice(0, 100)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/,/g, "")
    .replace(/[()*]/g, "")
    .trim();
}

export default async function RecipientsList({ searchParams }: { searchParams?: SearchParams }) {
  const supabase = supabaseServer();
  const showArchived = searchParams?.show === "archived";

  const sortRaw = (searchParams?.sort ?? "approved") as SortCol;
  const sortCol: SortCol = VALID_SORTS.includes(sortRaw) ? sortRaw : "approved";
  const dir: "asc" | "desc" = searchParams?.dir === "asc" ? "asc" : "desc";

  // Map UI col → Supabase order target
  const sortMap: Record<SortCol, { col: string; foreignTable?: string }> = {
    family:   { col: "parent_names", foreignTable: "applications" },
    cap:      { col: "approved_amount" },
    status:   { col: "status" },
    approved: { col: "created_at" },
    cohort:   { col: "cohort_year" },
  };
  const sortTarget = sortMap[sortCol];

  let q = supabase
    .from("recipients")
    .select("id, approved_amount, reimbursement_rate, status, created_at, cohort_year, archived_at, applications!inner(app_ref, parent_names, city, contact_email)");

  // By default hide archived rows; show only when ?show=archived.
  if (showArchived) q = q.not("archived_at", "is", null);
  else              q = q.is("archived_at", null);

  if (searchParams?.cohort && /^\d{4}$/.test(searchParams.cohort)) {
    q = q.eq("cohort_year", Number(searchParams.cohort));
  }
  if (searchParams?.status && ["active", "completed", "suspended"].includes(searchParams.status)) {
    q = q.eq("status", searchParams.status);
  }

  // Sanitized free-text search across family / email / app_ref / city
  const searchRaw = (searchParams?.q ?? "").trim();
  const term = sanitizeSearch(searchRaw);
  if (term) {
    q = q.or(
      `parent_names.ilike.%${term}%,contact_email.ilike.%${term}%,app_ref.ilike.%${term}%,city.ilike.%${term}%`,
      { foreignTable: "applications" }
    );
  }

  // Sort
  q = sortTarget.foreignTable
    ? q.order(sortTarget.col, { ascending: dir === "asc", referencedTable: sortTarget.foreignTable })
    : q.order(sortTarget.col, { ascending: dir === "asc" });

  const { data: recipients } = await q;

  // Distinct cohort years for filter
  const { data: cohortRows } = await supabase.from("recipients").select("cohort_year").not("cohort_year", "is", null);
  const cohortYears = Array.from(new Set((cohortRows ?? []).map((r: any) => r.cohort_year))).sort((a: number, b: number) => b - a);

  // Compute paid-to-date in one batched query
  let paidByRecipient: Record<string, number> = {};
  if (recipients && recipients.length > 0) {
    const { data: paid } = await supabase
      .from("payouts")
      .select("recipient_id, amount, status")
      .in("recipient_id", recipients.map((r: any) => r.id))
      .eq("status", "paid");
    (paid || []).forEach((p: any) => {
      paidByRecipient[p.recipient_id] = (paidByRecipient[p.recipient_id] || 0) + Number(p.amount);
    });
  }

  // For SortHeader: preserve other filter params when sort clicked
  const extra: Record<string, string | undefined> = {
    q:      searchRaw || undefined,
    cohort: searchParams?.cohort,
    status: searchParams?.status,
    show:   showArchived ? "archived" : undefined,
  };
  const base = "/admin/recipients";

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Funded families</span>
          <h1 className="ra-h1">Recipients</h1>
          <p className="ra-quiet">Approved families currently receiving reimbursements.</p>
        </div>
        <form method="get" style={{ display: "flex", gap: "0.5rem", alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label className="ra-label">Search</label>
            <input name="q" defaultValue={searchRaw} placeholder="name, email, ref, city…"
              className="ra-input" style={{ minWidth: 220 }} />
          </div>
          <div>
            <label className="ra-label">Cohort</label>
            <select name="cohort" defaultValue={searchParams?.cohort ?? ""} className="ra-input">
              <option value="">All years</option>
              {cohortYears.map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="ra-label">Status</label>
            <select name="status" defaultValue={searchParams?.status ?? ""} className="ra-input">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
          {/* Persist current sort so filter submit doesn't reset it */}
          <input type="hidden" name="sort" value={sortCol} />
          <input type="hidden" name="dir"  value={dir} />
          {showArchived && <input type="hidden" name="show" value="archived" />}
          <button type="submit" className="ra-btn">Apply</button>
          {(term || searchParams?.cohort || searchParams?.status) && (
            <Link href={base + (showArchived ? "?show=archived" : "")} className="ra-btn">Reset</Link>
          )}
        </form>
      </header>

      {term && (
        <div className="ra-quiet" style={{ marginBottom: "0.75rem", fontSize: "0.88rem" }}>
          Showing {recipients?.length ?? 0} match{(recipients?.length ?? 0) === 1 ? "" : "es"} for <strong>&ldquo;{searchRaw}&rdquo;</strong>
        </div>
      )}

      <div className="ra-table-card">
        <table className="ra-table ra-table-mobile">
          <thead>
            <tr>
              <SortHeader label="Family"   col="family"   currentSort={sortCol} currentDir={dir} basePath={base} extraParams={extra} />
              <SortHeader label="Cap"      col="cap"      currentSort={sortCol} currentDir={dir} basePath={base} extraParams={extra} />
              <th style={{ minWidth: 220 }}>Progress</th>
              <SortHeader label="Status"   col="status"   currentSort={sortCol} currentDir={dir} basePath={base} extraParams={extra} />
              <SortHeader label="Cohort"   col="cohort"   currentSort={sortCol} currentDir={dir} basePath={base} extraParams={extra} />
              <SortHeader label="Approved" col="approved" currentSort={sortCol} currentDir={dir} basePath={base} extraParams={extra} align="right" />
            </tr>
          </thead>
          <tbody>
            {(recipients || []).map((r: any) => {
              const paid = paidByRecipient[r.id] || 0;
              const cap = Number(r.approved_amount);
              const pct = cap > 0 ? paid / cap : 0;
              return (
                <tr key={r.id}>
                  <td data-label="Family">
                    <Link href={`/admin/recipients/${r.id}`}>
                      <AvatarRow name={r.applications.parent_names} secondary={`${r.applications.city} · ${r.applications.app_ref}`} />
                    </Link>
                  </td>
                  <td data-label="Cap">
                    <span style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem" }}>
                      ${cap.toFixed(2)}
                    </span>
                    <div className="ra-tiny">{(Number(r.reimbursement_rate) * 100).toFixed(0)}% rate</div>
                  </td>
                  <td data-label="Progress">
                    <ProgressBar value={pct} variant={pct >= 0.99 ? "success" : "default"} ariaLabel={`${Math.round(pct * 100)}% paid out`} />
                    <div className="ra-tiny" style={{ marginTop: "0.3rem" }}>
                      ${paid.toFixed(2)} paid · ${(cap - paid).toFixed(2)} remaining
                    </div>
                  </td>
                  <td data-label="Status"><StatusBadge status={r.status} /></td>
                  <td data-label="Cohort" className="ra-tiny">{r.cohort_year ?? "—"}</td>
                  <td data-label="Approved" style={{ textAlign: "right" }} className="ra-tiny">
                    {new Date(r.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                  </td>
                </tr>
              );
            })}
            {(!recipients || recipients.length === 0) && (
              <tr>
                <td colSpan={6}>
                  <div className="ra-empty">
                    <div className="ra-empty-icon">❀</div>
                    <div className="ra-empty-title">{term ? "No matches" : "No recipients yet"}</div>
                    <div>{term ? <>Try a different search or <Link href={base} className="ra-link">reset filters</Link>.</> : <>Approve an application to create one.</>}</div>
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

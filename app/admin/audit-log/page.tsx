// /admin/audit-log — read-only timeline of admin actions.
//   ?action=...   filter on action type
//   ?actor=...    filter on actor email substring
//   ?from=YYYY-MM-DD &to=YYYY-MM-DD   date range
import Link from "next/link";
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  decide_application:    "App decided",
  decide_receipt:        "Receipt decided",
  mark_paid:             "Payout marked paid",
  modify_recipient:      "Recipient modified",
  approve_testimonial:   "Testimonial approved",
  hide_testimonial:      "Testimonial hidden",
  feature_testimonial:   "Testimonial featured",
  update_settings:       "Settings updated",
  add_note:              "Note added",
  delete_note:           "Note deleted",
  create_recipient:      "Recipient created",
};

function pretty(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export default async function AuditLogPage({ searchParams }: {
  searchParams?: { action?: string; actor?: string; from?: string; to?: string };
}) {
  const svc = supabaseService();

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const safeFrom = searchParams?.from && DATE_RE.test(searchParams.from) ? searchParams.from : null;
  const safeTo   = searchParams?.to   && DATE_RE.test(searchParams.to)   ? searchParams.to   : null;

  let q = svc.from("audit_log").select(`
    id, action, target_table, target_id, details, created_at,
    profiles:actor_id(email)
  `).order("created_at", { ascending: false }).limit(500);

  if (searchParams?.action) q = q.eq("action", searchParams.action);
  if (safeFrom) q = q.gte("created_at", `${safeFrom}T00:00:00Z`);
  if (safeTo)   q = q.lte("created_at", `${safeTo}T23:59:59Z`);

  const { data: rows, error } = await q;
  let filtered = rows ?? [];
  if (searchParams?.actor) {
    const needle = searchParams.actor.toLowerCase();
    filtered = filtered.filter((r: any) => (r.profiles?.email ?? "").toLowerCase().includes(needle));
  }

  // Distinct actions for the filter dropdown
  const allActions = Array.from(new Set([...(rows ?? []).map((r: any) => r.action)])).sort();

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Compliance</span>
          <h1 className="ra-h1">Audit log</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Who did what, when. Read-only. Last 500 events shown. Required for CRA review.
          </p>
        </div>
        <Link href="/api/admin/exports/audit_log" className="ra-btn ra-btn-primary">⬇ Export CSV</Link>
      </header>

      {/* Filters */}
      <form method="get" className="ra-card" style={{ marginBottom: "1.25rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem" }}>
        <div>
          <label className="ra-label">Action</label>
          <select name="action" defaultValue={searchParams?.action ?? ""} className="ra-input">
            <option value="">All actions</option>
            {allActions.map((a) => <option key={a} value={a}>{pretty(a)}</option>)}
          </select>
        </div>
        <div>
          <label className="ra-label">Actor email</label>
          <input name="actor" type="text" defaultValue={searchParams?.actor ?? ""} placeholder="tierza..." className="ra-input" />
        </div>
        <div>
          <label className="ra-label">From</label>
          <input name="from" type="date" defaultValue={searchParams?.from ?? ""} className="ra-input" />
        </div>
        <div>
          <label className="ra-label">To</label>
          <input name="to" type="date" defaultValue={searchParams?.to ?? ""} className="ra-input" />
        </div>
        <div style={{ display: "flex", alignItems: "end", gap: "0.5rem" }}>
          <button type="submit" className="ra-btn ra-btn-primary">Apply</button>
          <Link href="/admin/audit-log" className="ra-btn">Reset</Link>
        </div>
      </form>

      {error && <div className="ra-alert-error" style={{ marginBottom: "1rem" }}>{error.message}</div>}

      <div className="ra-card ra-table-card">
        {filtered.length === 0 ? (
          <div className="ra-empty">
            <div className="ra-empty-icon">∅</div>
            <div className="ra-empty-title">No audit events match</div>
            <div>Try widening the date range.</div>
          </div>
        ) : (
          <table className="ra-table ra-table-mobile">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: any) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.profiles?.email ?? <span className="ra-quiet">(system)</span>}</td>
                  <td><strong>{pretty(r.action)}</strong></td>
                  <td className="ra-tiny">
                    {r.target_table}<br />
                    <span style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{r.target_id}</span>
                  </td>
                  <td>
                    <details>
                      <summary style={{ cursor: "pointer", color: "var(--ra-accent)", fontSize: "0.82rem" }}>
                        {Object.keys(r.details ?? {}).length} fields
                      </summary>
                      <pre style={{
                        fontSize: "0.74rem", marginTop: "0.5rem",
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                        background: "rgba(0,0,0,0.04)", padding: "0.5rem",
                        borderRadius: 6, maxWidth: 520,
                      }}>{JSON.stringify(r.details, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// /admin/broadcasts — send a one-off email to all active recipients (or admins).
import { supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext } from "@/app/lib/org-context";
import { BroadcastForm } from "./BroadcastForm";
import { BroadcastRow, type BroadcastRowData } from "./BroadcastRow";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const ctx = await requireOrgContext();
  const svc = supabaseService();
  const [{ count: activeCount }, { count: allCount }, history] = await Promise.all([
    // Archived families are excluded from the send, so exclude them from the
    // count too — otherwise the number on the confirm checkbox won't match
    // what actually goes out and it reads as a bug.
    svc.from("recipients").select("id", { count: "exact", head: true })
      .eq("org_id", ctx.id).eq("status", "active").is("archived_at", null),
    svc.from("recipients").select("id", { count: "exact", head: true })
      .eq("org_id", ctx.id).is("archived_at", null),
    // select("*") deliberately: naming state/total_count/progress_at would 400
    // the ENTIRE query on a database that hasn't had the migration applied,
    // and the whole broadcast history would render blank.
    svc.from("broadcasts")
      .select("*, profiles:sent_by(email)")
      .eq("org_id", ctx.id)
      .order("created_at", { ascending: false }).limit(20),
  ]);

  // Per-recipient progress. Tolerant of the ledger not existing yet.
  const ids = (history.data as any[] ?? []).map((b) => b.id);
  const progress = new Map<string, { sent: number; failed: number; pending: number }>();
  if (ids.length) {
    const { data: ledger } = await svc.from("broadcast_sends")
      .select("broadcast_id, status").in("broadcast_id", ids);
    for (const r of (ledger ?? []) as any[]) {
      const cur = progress.get(r.broadcast_id) ?? { sent: 0, failed: 0, pending: 0 };
      if (r.status === "sent") cur.sent++;
      else if (r.status === "failed") cur.failed++;
      else cur.pending++;
      progress.set(r.broadcast_id, cur);
    }
  }

  const rows: BroadcastRowData[] = (history.data as any[] ?? []).map((b) => {
    const p = progress.get(b.id) ?? { sent: b.recipient_count ?? 0, failed: b.failed_count ?? 0, pending: 0 };
    return {
      id: b.id, subject: b.subject, audience: b.audience, created_at: b.created_at,
      sent_by_email: b.profiles?.email ?? null,
      state: b.state ?? "sent",
      scheduled_for: b.scheduled_for ?? null,
      materialized_at: b.materialized_at ?? null,
      progress_at: b.progress_at ?? null,
      total_count: b.total_count ?? null,
      ...p,
    };
  });

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Program announcements</span>
          <h1 className="ra-h1">Broadcast email</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Send one email to every family in the program. Use sparingly — they trust your inbox.
          </p>
        </div>
      </header>

      <BroadcastForm
        counts={{ active: activeCount ?? 0, all: allCount ?? 0 }}
      />

      <section className="ra-card" style={{ marginTop: "1.5rem" }}>
        <h2 className="ra-section-title">Recent broadcasts</h2>
        {rows.length === 0 ? (
          <div className="ra-quiet">Nothing sent yet.</div>
        ) : (
          <table className="ra-table ra-table-mobile">
            <thead><tr><th>When</th><th>By</th><th>Subject</th><th>Audience</th><th>Status</th><th style={{ textAlign: "right" }}>Sent</th><th style={{ textAlign: "right" }}>Failed</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => <BroadcastRow key={r.id} row={r} />)}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

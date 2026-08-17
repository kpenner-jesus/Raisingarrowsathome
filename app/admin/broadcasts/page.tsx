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

  // Progress per broadcast.
  //
  // This used to pull every broadcast_sends row for the last 20 broadcasts in
  // one .in() with no limit, which hits the same 1000-row ceiling the send
  // path was rewritten to avoid: a fully delivered broadcast could render as
  // "48 / 300" - indistinguishable from the stranded state this page exists to
  // reveal, and different on every reload.
  //
  // Instead: finished broadcasts already carry their totals on the row, and
  // only the ones still in flight need counting - normally none or one.
  const progress = new Map<string, { sent: number; failed: number; pending: number }>();
  const inFlight = (history.data as any[] ?? []).filter((b) => b.state === "sending");
  for (const b of inFlight) {
    const one = async (status: string) => {
      const { count } = await svc.from("broadcast_sends")
        .select("id", { head: true, count: "exact" }).eq("broadcast_id", b.id).eq("status", status);
      return count ?? 0;
    };
    const [sent, failed, pending] = await Promise.all([one("sent"), one("failed"), one("pending")]);
    progress.set(b.id, { sent, failed, pending });
  }

  const renderedAt = Date.now();
  const rows: BroadcastRowData[] = (history.data as any[] ?? []).map((b) => {
    // For a settled broadcast the counters ON THE ROW are authoritative (they
    // were recomputed from the ledger when it finished). pending is whatever
    // the frozen total doesn't account for - which is how "Incomplete" shows up.
    const settledSent = b.recipient_count ?? 0;
    const settledFailed = b.failed_count ?? 0;
    const settledPending = b.total_count == null
      ? 0
      : Math.max(0, b.total_count - settledSent - settledFailed);
    const p = progress.get(b.id) ?? { sent: settledSent, failed: settledFailed, pending: settledPending };
    return {
      id: b.id, subject: b.subject, audience: b.audience, created_at: b.created_at,
      sent_by_email: b.profiles?.email ?? null,
      // Formatted here, not in the client component: toLocaleString() resolves
      // differently on the server and in the visitor's browser, which is a
      // hydration mismatch on every single row.
      created_label: new Date(b.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" }),
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
              {/* nowMs from the SERVER so the first client render matches the
                  server HTML exactly; the row switches to live time on mount. */}
              {rows.map((r) => <BroadcastRow key={r.id} row={r} nowMs={renderedAt} />)}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

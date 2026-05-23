// /admin/broadcasts — send a one-off email to all active recipients (or admins).
import { supabaseService } from "@/app/lib/supabase/server";
import { BroadcastForm } from "./BroadcastForm";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const svc = supabaseService();
  const [{ count: activeCount }, { count: allCount }, history] = await Promise.all([
    svc.from("recipients").select("id", { count: "exact", head: true }).eq("status", "active"),
    svc.from("recipients").select("id", { count: "exact", head: true }),
    svc.from("broadcasts")
      .select("id, subject, audience, recipient_count, failed_count, created_at, profiles:sent_by(email)")
      .order("created_at", { ascending: false }).limit(20),
  ]);

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
        {(history.data?.length ?? 0) === 0 ? (
          <div className="ra-quiet">Nothing sent yet.</div>
        ) : (
          <table className="ra-table">
            <thead><tr><th>When</th><th>By</th><th>Subject</th><th>Audience</th><th style={{ textAlign: "right" }}>Sent</th><th style={{ textAlign: "right" }}>Failed</th></tr></thead>
            <tbody>
              {(history.data as any[]).map((b) => (
                <tr key={b.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(b.created_at).toLocaleString()}</td>
                  <td>{b.profiles?.email ?? "—"}</td>
                  <td>{b.subject}</td>
                  <td className="ra-tiny">{b.audience}</td>
                  <td style={{ textAlign: "right" }}>{b.recipient_count}</td>
                  <td style={{ textAlign: "right", color: b.failed_count > 0 ? "var(--ra-danger)" : "inherit" }}>{b.failed_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

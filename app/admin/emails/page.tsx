// /admin/emails
//
// Two sources, in order of reliability:
//  1. Webhook events from the email_events table (Resend → POST our
//     /api/webhooks/resend → row inserted). Captures delivery /
//     bounce / open / click reliably regardless of API key scope.
//  2. Resend REST list (last 100 sends). REQUIRES a full-access API
//     key; sending-only restricted keys 401. Failure is non-fatal —
//     we surface a hint and let the webhook section carry the page.
import { supabaseService } from "@/app/lib/supabase/server";

export const dynamic = "force-dynamic";

interface ResendEmail {
  id: string;
  to: string[];
  from: string;
  subject: string;
  last_event: string;
  created_at: string;
}

async function fetchEmails(): Promise<{ data: ResendEmail[]; error?: string; restricted?: boolean }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { data: [], error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails?limit=100", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (res.status === 401) {
      const j = await res.json().catch(() => ({} as any));
      return { data: [], restricted: true, error: j?.message || "API key restricted" };
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { data: [], error: `Resend returned ${res.status}: ${t.slice(0, 200)}` };
    }
    const j = await res.json();
    return { data: j.data ?? [] };
  } catch (e: any) {
    return { data: [], error: e?.message ?? "fetch failed" };
  }
}

async function fetchWebhookEvents() {
  const svc = supabaseService();
  const { data } = await svc.from("email_events")
    .select("id, resend_id, event_type, recipient_email, subject, created_at")
    .order("created_at", { ascending: false }).limit(100);
  return data ?? [];
}

function eventTint(ev: string): string {
  if (ev === "delivered") return "var(--ra-success)";
  if (ev === "bounced" || ev === "failed" || ev === "complained") return "var(--ra-danger)";
  if (ev === "opened" || ev === "clicked") return "var(--ra-accent)";
  return "var(--ra-ink-muted)";
}

export default async function EmailsPage() {
  const [{ data, error, restricted }, events] = await Promise.all([fetchEmails(), fetchWebhookEvents()]);

  // Webhook is configured at the deploy level — assume reachable. Empty state
  // is "nothing yet" not "set up the webhook".
  const webhookConfigured = !!process.env.RESEND_WEBHOOK_SECRET;

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Outbound mail</span>
          <h1 className="ra-h1">Email log</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Every email this site sends — magic links, payout notifications, broadcasts — is tracked here.
            See who opened, who bounced, who clicked.
          </p>
        </div>
      </header>

      {/* PRIMARY: webhook events */}
      <section className="ra-card" style={{ marginBottom: "1.25rem" }}>
        <h2 className="ra-section-title">Delivery events ({events.length})</h2>
        {events.length === 0 ? (
          webhookConfigured ? (
            <div className="ra-empty">
              <div className="ra-empty-icon">✉</div>
              <div className="ra-empty-title">No events to show yet</div>
              <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginTop: "0.4rem" }}>
                Send a test email (broadcast, decide an application, mark a payout paid)
                and delivery events will appear here within seconds — opens, clicks, bounces, the works.
              </div>
            </div>
          ) : (
            <div className="ra-empty">
              <div className="ra-empty-icon">⚙</div>
              <div className="ra-empty-title">Webhook isn't wired up on this deploy</div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Set <code>RESEND_WEBHOOK_SECRET</code> in this deploy's env vars +
                add the endpoint <code>/api/webhooks/resend</code> in the Resend dashboard.
              </div>
            </div>
          )
        ) : (
          <table className="ra-table ra-table-mobile">
            <thead><tr><th>When</th><th>Event</th><th>To</th><th>Subject</th></tr></thead>
            <tbody>
              {events.map((e: any) => (
                <tr key={e.id}>
                  <td data-label="When"    style={{ whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleString()}</td>
                  <td data-label="Event"><span style={{ color: eventTint(e.event_type), fontWeight: 500 }}>{e.event_type}</span></td>
                  <td data-label="To">{e.recipient_email}</td>
                  <td data-label="Subject">{e.subject || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* SECONDARY: live Resend API list (optional) */}
      <section className="ra-card">
        <h2 className="ra-section-title">Recent sends (Resend API)</h2>
        {restricted ? (
          <div className="ra-empty">
            <div className="ra-empty-icon">🔑</div>
            <div className="ra-empty-title">This list needs a full-access Resend key</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              The send-only key in use right now can&apos;t list emails. Webhook events above still flow normally.
            </div>
          </div>
        ) : error ? (
          <div className="ra-alert-error">{error}</div>
        ) : data.length === 0 ? (
          <div className="ra-quiet">No sends in the last 100 messages.</div>
        ) : (
          <table className="ra-table ra-table-mobile">
            <thead>
              <tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td data-label="When"    style={{ whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleString()}</td>
                  <td data-label="To">{(e.to ?? []).join(", ")}</td>
                  <td data-label="Subject">{e.subject}</td>
                  <td data-label="Status"><span style={{ color: eventTint(e.last_event), fontWeight: 500 }}>{e.last_event}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// /admin/emails
//
// ONE source: webhook events from the email_events table (Resend → POST our
// /api/webhooks/resend → row inserted), scoped to the signed-in tenant.
//
// There used to be a second panel that listed the last 100 sends straight from
// GET https://api.resend.com/emails. It was removed because that endpoint is
// scoped to the RESEND ACCOUNT, not to a tenant and not to an environment:
//   - every charity on the platform shares one Resend account, so it showed
//     one tenant's admin the recipients and subjects of every OTHER tenant's
//     mail — a cross-tenant disclosure with no filter available on the API;
//   - production and staging share that account too, so each environment's
//     admin page listed the other's mail.
// The webhook table above carries the same information (and more: opens,
// clicks, bounces) already filtered by org_id, so nothing of value was lost.
import { supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext } from "@/app/lib/org-context";

export const dynamic = "force-dynamic";

async function fetchWebhookEvents(orgId: string) {
  const svc = supabaseService();
  const { data } = await svc.from("email_events")
    .select("id, resend_id, event_type, recipient_email, subject, created_at")
    .eq("org_id", orgId)
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
  const ctx = await requireOrgContext();
  const events = await fetchWebhookEvents(ctx.id);

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

    </div>
  );
}

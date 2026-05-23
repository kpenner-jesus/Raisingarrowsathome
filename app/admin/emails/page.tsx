// /admin/emails — recent sends fetched live from Resend.
export const dynamic = "force-dynamic";

interface ResendEmail {
  id: string;
  to: string[];
  from: string;
  subject: string;
  last_event: string;     // 'sent' | 'delivered' | 'bounced' | 'opened' | 'clicked'
  created_at: string;
}

async function fetchEmails(): Promise<{ data: ResendEmail[]; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { data: [], error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails?limit=100", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
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

function eventTint(ev: string): string {
  if (ev === "delivered") return "var(--ra-success)";
  if (ev === "bounced")   return "var(--ra-danger)";
  if (ev === "opened" || ev === "clicked") return "var(--ra-accent)";
  return "var(--ra-ink-muted)";
}

export default async function EmailsPage() {
  const { data, error } = await fetchEmails();
  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">Outbound mail</span>
          <h1 className="ra-h1">Email log</h1>
          <p className="ra-quiet" style={{ marginTop: "0.15rem" }}>
            Last 100 sends, live from Resend. Use to confirm delivery / debug bounces.
          </p>
        </div>
      </header>

      {error && <div className="ra-alert-error">{error}</div>}

      <div className="ra-table-card">
        <table className="ra-table">
          <thead>
            <tr>
              <th>When</th>
              <th>To</th>
              <th>Subject</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={4}><div className="ra-empty"><div className="ra-empty-icon">✉</div><div className="ra-empty-title">No emails yet</div></div></td></tr>
            ) : data.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleString()}</td>
                <td>{(e.to ?? []).join(", ")}</td>
                <td>{e.subject}</td>
                <td><span style={{ color: eventTint(e.last_event), fontWeight: 500 }}>{e.last_event}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

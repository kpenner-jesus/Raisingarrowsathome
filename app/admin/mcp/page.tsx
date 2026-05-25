import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext } from "@/app/lib/org-context";
import { HelpHint } from "@/app/_components/HelpHint";
import TokenManager from "./TokenManager";

export const dynamic = "force-dynamic";

export default async function McpPage() {
  const ctx = await requireOrgContext();
  const auth = supabaseServer();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return null;

  const service = supabaseService();
  const { data: tokens } = await service
    .from("api_tokens")
    .select("id, label, prefix, created_at, last_used_at, revoked_at, expires_at")
    .eq("org_id", ctx.id)
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <header className="ra-page-header">
        <div className="ra-page-title-block">
          <span className="ra-eyebrow">AI control plane</span>
          <h1 className="ra-h1">
            MCP — drive this portal from your AI
            <HelpHint
              tone="dark"
              title="MCP"
              body="Model Context Protocol — a standard for letting AI assistants call APIs. This portal exposes 17 admin tools (approve applications, decide receipts, generate payouts, etc.) so you can run the grant program by chatting with Claude instead of clicking through UI."
              examples={[
                "Tell Claude: 'List all pending applications and summarize them' — it will call list_applications + draft the summary.",
                "Tell Claude: 'Approve Jane Doe's application at $500, 75%' — it will call decide_application.",
                "Tell Claude: 'Generate the May 15 payout batch and export the CSV' — it will run generate_payout_batch + export_batch_csv.",
              ]}
            />
          </h1>
          <p className="ra-quiet" style={{ maxWidth: 640, lineHeight: 1.6 }}>
            Mint a token below, paste the one-liner into Claude Code or Claude Desktop, restart Claude — done.
            Every action you can do here you can ask Claude to do for you.
          </p>
        </div>
      </header>

      {/* ── What you can do ─────────────────────────────────── */}
      <section className="ra-card" style={{ marginBottom: "1.5rem" }}>
        <h3 className="ra-section-title">What the AI can do once connected</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
          {[
            { t: "Review applications", d: "List pending, fetch details, approve or deny with notes." },
            { t: "Manage recipients",   d: "Search, modify caps + rates, suspend, view balance." },
            { t: "Review receipts",     d: "Approve / reject with reimbursable amount in CAD." },
            { t: "Run payout batches",  d: "Generate, export CSV (for CEO Ministries), mark paid." },
            { t: "Bulk imports",        d: "Add 20 new recipients in one MCP call (no spreadsheet upload needed)." },
            { t: "View receipts + photos", d: "Sign short-lived URLs to inspect any file." },
          ].map((c) => (
            <div key={c.t} className="ra-card-tight" style={{ background: "var(--ra-bg)", border: "1px solid var(--ra-line)", borderRadius: "var(--ra-radius)" }}>
              <div style={{ fontWeight: 600, fontSize: "0.92rem", marginBottom: "0.25rem" }}>{c.t}</div>
              <div style={{ fontSize: "0.85rem", color: "var(--ra-ink-soft)" }}>{c.d}</div>
            </div>
          ))}
        </div>
      </section>

      <TokenManager initialTokens={tokens || []} />

      {/* ── Connect snippets ────────────────────────────────── */}
      <section className="ra-card" style={{ marginBottom: "1.5rem" }}>
        <h3 className="ra-section-title">Connect Claude</h3>

        <h4 className="ra-h3" style={{ marginTop: "0.5rem", marginBottom: "0.4rem" }}>
          Claude Code (terminal)
        </h4>
        <p className="ra-tiny" style={{ marginBottom: "0.4rem" }}>
          Open a new terminal (not inside Claude Code itself) and run:
        </p>
        <pre style={preStyle}>
{`claude mcp add raising-arrows --scope user --transport http \\
  --header 'Authorization: Bearer YOUR_TOKEN_HERE' \\
  https://raisingarrowsathome.com/api/mcp`}
        </pre>
        <p className="ra-tiny" style={{ marginBottom: "1.25rem" }}>
          Then restart Claude Code. New tools appear under <code>mcp__raising-arrows__*</code>.
        </p>

        <h4 className="ra-h3" style={{ marginTop: "1.5rem", marginBottom: "0.4rem" }}>
          Claude Desktop (claude.ai/download)
        </h4>
        <p className="ra-tiny" style={{ marginBottom: "0.4rem" }}>
          Open Settings → Developer → Edit Config, paste this inside the <code>mcpServers</code> object:
        </p>
        <pre style={preStyle}>
{`"raising-arrows": {
  "transport": {
    "type": "http",
    "url": "https://raisingarrowsathome.com/api/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_TOKEN_HERE"
    }
  }
}`}
        </pre>
        <p className="ra-tiny" style={{ marginBottom: "0.25rem" }}>
          Restart Claude Desktop. Look for the wrench icon in the chat to confirm tools are loaded.
        </p>
      </section>

      {/* ── Safety ──────────────────────────────────────────── */}
      <section className="ra-alert ra-alert-warn" style={{ alignItems: "flex-start", lineHeight: 1.6 }}>
        <span className="ra-badge-dot" style={{ marginTop: "0.3rem", flexShrink: 0 }} />
        <span>
          <strong>Treat tokens like passwords.</strong> Anyone with one can run every admin action in your name.
          If you suspect leakage, revoke it below and mint a new one. Tokens never expire automatically — set
          per-machine and rotate yearly.
        </span>
      </section>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  background: "var(--ra-ink)",
  color: "#fff",
  padding: "0.85rem 1rem",
  borderRadius: 8,
  fontSize: "0.78rem",
  lineHeight: 1.55,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  overflowX: "auto",
  whiteSpace: "pre",
};

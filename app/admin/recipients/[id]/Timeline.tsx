// Timeline: union of receipts, payouts, notes, and audit events for one recipient.
import { supabaseService } from "@/app/lib/supabase/server";
import { requireOrgContext } from "@/app/lib/org-context";

interface Row {
  at: string;
  kind: "receipt" | "payout" | "note" | "audit";
  title: string;
  detail?: string;
  tone?: "ok" | "warn" | "bad" | "muted";
}

export async function Timeline({ recipientId, applicationId }: { recipientId: string; applicationId: string | null }) {
  const ctx = await requireOrgContext();
  const svc = supabaseService();

  const [receiptsQ, payoutsQ, notesQ, auditQ] = await Promise.all([
    svc.from("receipts").select("id, status, amount, currency, description, created_at, decided_at, reimbursable_amount")
      .eq("org_id", ctx.id)
      .eq("recipient_id", recipientId),
    svc.from("payouts").select("id, amount, currency, status, created_at, paid_at, reversed_at, reversal_reason")
      .eq("org_id", ctx.id)
      .eq("recipient_id", recipientId),
    svc.from("recipient_notes").select("id, body, created_at, profiles:author_id(email)")
      .eq("org_id", ctx.id)
      .eq("recipient_id", recipientId),
    svc.from("audit_log").select("id, action, target_table, target_id, details, created_at, profiles:actor_id(email)")
      .eq("org_id", ctx.id)
      .or(`and(target_table.eq.recipients,target_id.eq.${recipientId})${applicationId ? `,and(target_table.eq.applications,target_id.eq.${applicationId})` : ""}`),
  ]);

  const rows: Row[] = [];

  for (const r of (receiptsQ.data ?? []) as any[]) {
    rows.push({
      at: r.created_at,
      kind: "receipt",
      title: `Receipt uploaded · $${Number(r.amount).toFixed(2)} ${r.currency || "CAD"}`,
      detail: r.description || "",
      tone: r.status === "approved" ? "ok" : r.status === "rejected" ? "bad" : "muted",
    });
    if (r.decided_at && r.decided_at !== r.created_at) {
      rows.push({
        at: r.decided_at,
        kind: "receipt",
        title: `Receipt ${r.status} · $${Number(r.amount).toFixed(2)}${r.reimbursable_amount ? ` (CAD $${Number(r.reimbursable_amount).toFixed(2)} reimbursable)` : ""}`,
        detail: r.description || "",
        tone: r.status === "approved" ? "ok" : "bad",
      });
    }
  }
  for (const p of (payoutsQ.data ?? []) as any[]) {
    rows.push({
      at: p.created_at,
      kind: "payout",
      title: `Payout queued · $${Number(p.amount).toFixed(2)} ${p.currency || "CAD"}`,
      tone: "muted",
    });
    if (p.paid_at) {
      rows.push({
        at: p.paid_at,
        kind: "payout",
        title: `Payout paid · $${Number(p.amount).toFixed(2)}`,
        tone: "ok",
      });
    }
    if (p.reversed_at) {
      rows.push({
        at: p.reversed_at,
        kind: "payout",
        title: `Payout reversed · $${Number(p.amount).toFixed(2)}`,
        detail: p.reversal_reason || "",
        tone: "bad",
      });
    }
  }
  for (const n of (notesQ.data ?? []) as any[]) {
    rows.push({
      at: n.created_at,
      kind: "note",
      title: `Note · ${n.profiles?.email ?? "admin"}`,
      detail: n.body,
      tone: "warn",
    });
  }
  for (const a of (auditQ.data ?? []) as any[]) {
    rows.push({
      at: a.created_at,
      kind: "audit",
      title: `${a.action} · ${a.profiles?.email ?? "system"}`,
      detail: a.details ? JSON.stringify(a.details).slice(0, 160) : "",
      tone: "muted",
    });
  }

  rows.sort((a, b) => b.at.localeCompare(a.at));

  if (rows.length === 0) {
    return (
      <section className="ra-card">
        <h3 className="ra-section-title">Timeline</h3>
        <div className="ra-quiet">Nothing recorded yet.</div>
      </section>
    );
  }

  return (
    <section className="ra-card">
      <h3 className="ra-section-title">Timeline</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {rows.map((r, i) => (
          <li key={i} style={{
            display: "grid",
            gridTemplateColumns: "12px 1fr auto",
            gap: "0.75rem", alignItems: "flex-start",
            padding: "0.45rem 0", borderBottom: "1px dashed var(--ra-line)",
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%", marginTop: 6,
              background: r.tone === "ok"   ? "var(--ra-success)"
                        : r.tone === "bad"  ? "var(--ra-danger)"
                        : r.tone === "warn" ? "var(--ra-accent)"
                        :                     "var(--ra-ink-quiet)",
            }} />
            <span style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: "0.9rem" }}>{r.title}</div>
              {r.detail && <div className="ra-tiny" style={{ marginTop: "0.15rem", whiteSpace: "pre-wrap" }}>{r.detail}</div>}
            </span>
            <span className="ra-tiny" style={{ flexShrink: 0, color: "var(--ra-ink-quiet)" }}>
              {new Date(r.at).toLocaleString("en-CA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

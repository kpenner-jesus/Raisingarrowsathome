"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Cat { id: string; label: string; sort_order: number; archived_at: string | null }

export function CategoriesEditor({ items }: { items: Cat[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");

  async function call(method: string, body: any) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/categories", {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  const active   = items.filter((i) => !i.archived_at);
  const archived = items.filter((i) =>  i.archived_at);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {error && <div className="ra-alert-error">{error}</div>}

      <section className="ra-card">
        <h2 className="ra-section-title">Active ({active.length})</h2>
        {active.length === 0 ? <div className="ra-quiet">None.</div> : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            {active.map((c) => (
              <li key={c.id} className="ra-row-between" style={{ padding: "0.45rem 0.65rem", border: "1px solid var(--ra-line)", borderRadius: 8 }}>
                <span><strong style={{ fontWeight: 500 }}>{c.label}</strong> <span className="ra-tiny">· order {c.sort_order}</span></span>
                <button className="ra-btn" disabled={busy} onClick={() => call("PATCH", { id: c.id, archived: true })}
                  style={{ fontSize: "0.78rem", padding: "0.2rem 0.6rem" }}>Archive</button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem" }}>
          <input className="ra-input" placeholder="New category label…" value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)} maxLength={60} />
          <button className="ra-btn ra-btn-primary" disabled={busy || !newLabel.trim()}
            onClick={() => { call("POST", { label: newLabel.trim() }); setNewLabel(""); }}>
            + Add
          </button>
        </div>
      </section>

      {archived.length > 0 && (
        <section className="ra-card">
          <h2 className="ra-section-title">Archived ({archived.length})</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {archived.map((c) => (
              <li key={c.id} className="ra-row-between" style={{ padding: "0.35rem 0.65rem", border: "1px dashed var(--ra-line)", borderRadius: 8, color: "var(--ra-ink-muted)" }}>
                <span>{c.label}</span>
                <button className="ra-btn" disabled={busy} onClick={() => call("PATCH", { id: c.id, archived: false })}
                  style={{ fontSize: "0.78rem", padding: "0.2rem 0.6rem" }}>Restore</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

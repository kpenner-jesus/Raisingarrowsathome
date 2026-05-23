"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Note {
  id: string;
  author_id: string | null;
  author_email: string;
  body: string;
  created_at: string;
}

export function ApplicationNotes({ applicationId, currentUserId, notes }: {
  applicationId: string;
  currentUserId: string | null;
  notes: Note[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (!draft.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/applications/${applicationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setDraft("");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(nid: string) {
    if (!confirm("Delete this note?")) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/applications/${applicationId}/notes?nid=${nid}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ra-card">
      <h3 className="ra-section-title">Internal notes</h3>
      <p className="ra-quiet" style={{ marginTop: 0, fontSize: "0.85rem" }}>
        Visible only to admins. Use for follow-ups, context, or anything you want the next admin to see.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: notes.length > 0 ? "1rem" : 0 }}>
        <textarea
          className="ra-input ra-textarea"
          placeholder="Add a note…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={4000}
          rows={3}
        />
        {err && <div className="ra-alert-error">{err}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", alignItems: "center" }}>
          <span className="ra-tiny">{draft.length}/4000</span>
          <button className="ra-btn ra-btn-primary" disabled={busy || !draft.trim()} onClick={add}>
            {busy ? "…" : "Add note"}
          </button>
        </div>
      </div>

      {notes.length === 0 ? null : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem", borderTop: "1px solid var(--ra-line)", paddingTop: "1rem" }}>
          {notes.map((n) => {
            const canDelete = !!currentUserId && n.author_id === currentUserId;
            return (
              <li key={n.id} style={{ padding: "0.6rem 0.75rem", background: "rgba(0,0,0,0.025)", borderRadius: 8 }}>
                <div className="ra-row-between" style={{ marginBottom: "0.3rem" }}>
                  <span className="ra-tiny"><strong>{n.author_email}</strong> · {new Date(n.created_at).toLocaleString()}</span>
                  {canDelete && (
                    <button className="ra-btn" disabled={busy} onClick={() => remove(n.id)} style={{ fontSize: "0.75rem", padding: "0.2rem 0.55rem" }}>Delete</button>
                  )}
                </div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: "0.92rem", color: "var(--ra-ink-soft)", lineHeight: 1.55 }}>{n.body}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

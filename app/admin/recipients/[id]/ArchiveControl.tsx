"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ArchiveControl({ recipientId, archivedAt, archiveReason }: {
  recipientId: string;
  archivedAt: string | null;
  archiveReason: string | null;
}) {
  const router = useRouter();
  const isArchived = !!archivedAt;
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function archive() {
    if (!reason.trim()) { setErr("Reason required"); return; }
    if (!confirm(`Archive this recipient? It will no longer appear in default lists.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "recipients", id: recipientId, reason }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      router.refresh();
      setShowForm(false); setReason("");
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!confirm("Restore this recipient to active lists?")) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: "recipients", id: recipientId, restore: true }),
      });
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
      <h3 className="ra-section-title">Archive</h3>

      {isArchived ? (
        <>
          <div className="ra-alert-error" style={{ marginBottom: "0.75rem" }}>
            <strong>Archived</strong> on {new Date(archivedAt!).toLocaleDateString()}.
            {archiveReason && <div style={{ marginTop: "0.3rem", fontStyle: "italic" }}>Reason: {archiveReason}</div>}
          </div>
          <button className="ra-btn ra-btn-primary" disabled={busy} onClick={restore}>
            {busy ? "Restoring…" : "Restore to active"}
          </button>
        </>
      ) : showForm ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <p className="ra-quiet" style={{ marginTop: 0 }}>
            Archived recipients are hidden from default lists but their data is preserved for the CRA retention period.
          </p>
          <textarea
            className="ra-input ra-textarea"
            rows={3}
            maxLength={500}
            placeholder="Reason (e.g. family completed program, moved out of province)…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {err && <div className="ra-alert-error">{err}</div>}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button className="ra-btn" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button>
            <button className="ra-btn" disabled={busy || !reason.trim()} onClick={archive}
              style={{ background: "var(--ra-danger)", color: "white", borderColor: "var(--ra-danger)" }}>
              {busy ? "Archiving…" : "Archive"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="ra-quiet" style={{ marginTop: 0, fontSize: "0.85rem" }}>
            Soft-delete: hides from active lists, keeps all data. Reversible.
          </p>
          <button className="ra-btn" onClick={() => setShowForm(true)}>Archive recipient…</button>
        </>
      )}
    </section>
  );
}

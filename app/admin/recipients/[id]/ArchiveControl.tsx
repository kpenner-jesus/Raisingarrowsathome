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
    if (!reason.trim()) { setErr("Please tell us why first."); return; }
    if (!confirm(`Move this family to the archive? They won't show up in your everyday list anymore (but the records are kept safe).`)) return;
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
    if (!confirm("Bring this family back into your everyday list?")) return;
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
            <strong>In the archive</strong> as of {new Date(archivedAt!).toLocaleDateString()}.
            {archiveReason && <div style={{ marginTop: "0.3rem", fontStyle: "italic" }}>Why: {archiveReason}</div>}
          </div>
          <button className="ra-btn ra-btn-primary" disabled={busy} onClick={restore}>
            {busy ? "Working…" : "Bring back to my list"}
          </button>
        </>
      ) : showForm ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <p className="ra-quiet" style={{ marginTop: 0 }}>
            Archived families don't show up in your everyday list, but all their info stays safe
            (we have to keep it for the CRA records).
          </p>
          <textarea
            className="ra-input ra-textarea"
            rows={3}
            maxLength={500}
            placeholder="Example: family finished the program, or moved out of province"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {err && <div className="ra-alert-error">{err}</div>}
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button className="ra-btn" disabled={busy} onClick={() => setShowForm(false)}>Never mind</button>
            <button className="ra-btn" disabled={busy || !reason.trim()} onClick={archive}
              style={{ background: "var(--ra-danger)", color: "white", borderColor: "var(--ra-danger)" }}>
              {busy ? "Working…" : "Move to archive"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="ra-quiet" style={{ marginTop: 0, fontSize: "0.85rem" }}>
            Tuck this family away in the archive. Their records stay safe and you can bring them back anytime.
          </p>
          <button className="ra-btn" onClick={() => setShowForm(true)}>Move to archive…</button>
        </>
      )}
    </section>
  );
}

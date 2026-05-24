"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReverseButton({ payoutId, amount }: { payoutId: string; amount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!reason.trim()) { setErr("Please tell us why first."); return; }
    if (!confirm(`Are you sure? This will flag the $${amount.toFixed(2)} that already went out as 'sent back'.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/payouts/${payoutId}/reverse`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setOpen(false); setReason("");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="ra-btn" onClick={() => setOpen(true)}
        style={{ fontSize: "0.78rem", padding: "0.2rem 0.55rem" }}>Money came back…</button>
      {open && (
        <div onClick={() => !busy && setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 14, padding: "1.5rem", maxWidth: 460, width: "100%" }}>
            <h3 className="ra-h2" style={{ marginBottom: "0.5rem" }}>Did this payment come back?</h3>
            <p className="ra-quiet" style={{ marginTop: 0 }}>
              Use this if an e-transfer bounced, went to the wrong email, or got cancelled.
              The payment record stays in the books, just marked as sent back so totals are correct.
            </p>
            <label className="ra-label">What happened?</label>
            <textarea className="ra-input ra-textarea" rows={3} maxLength={500}
              placeholder="Example: e-transfer bounced because the email on file was wrong"
              value={reason} onChange={(e) => setReason(e.target.value)} />
            {err && <div className="ra-alert-error" style={{ marginTop: "0.5rem" }}>{err}</div>}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="ra-btn" disabled={busy} onClick={() => setOpen(false)}>Never mind</button>
              <button className="ra-btn" disabled={busy || !reason.trim()} onClick={go}
                style={{ background: "var(--ra-danger)", color: "white", borderColor: "var(--ra-danger)" }}>
                {busy ? "Saving…" : "Mark as sent back"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

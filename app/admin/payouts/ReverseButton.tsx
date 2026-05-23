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
    if (!reason.trim()) { setErr("Reason required"); return; }
    if (!confirm(`Mark this $${amount.toFixed(2)} payout as reversed? Logged + audited.`)) return;
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
        style={{ fontSize: "0.78rem", padding: "0.2rem 0.55rem" }}>Reverse…</button>
      {open && (
        <div onClick={() => !busy && setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.55)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 14, padding: "1.5rem", maxWidth: 460, width: "100%" }}>
            <h3 className="ra-h2" style={{ marginBottom: "0.5rem" }}>Reverse payout</h3>
            <p className="ra-quiet" style={{ marginTop: 0 }}>Use when an e-transfer bounced, was sent to the wrong address, or otherwise needs to be undone. The payout will be flagged but not deleted.</p>
            <textarea className="ra-input ra-textarea" rows={3} maxLength={500}
              placeholder="Reason (e.g. e-transfer bounced — wrong email on file)…"
              value={reason} onChange={(e) => setReason(e.target.value)} />
            {err && <div className="ra-alert-error" style={{ marginTop: "0.5rem" }}>{err}</div>}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button className="ra-btn" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
              <button className="ra-btn" disabled={busy || !reason.trim()} onClick={go}
                style={{ background: "var(--ra-danger)", color: "white", borderColor: "var(--ra-danger)" }}>
                {busy ? "…" : "Confirm reverse"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

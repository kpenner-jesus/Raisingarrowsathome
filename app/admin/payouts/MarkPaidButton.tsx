"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "../_components/Toaster";

export default function MarkPaidButton({ batchId, total }: { batchId: string; total: number }) {
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [ref, setRef]   = useState("");

  const run = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/payouts/${batchId}/mark-paid`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ceo_reference: ref }),
    });
    setBusy(false);
    setOpen(false);
    if (!res.ok) { notify(`Failed: ${await res.text()}`, "error"); return; }
    const data = await res.json();
    notify(`Batch marked paid — ${data.recipients_notified} recipient(s) notified`);
    router.refresh();
  };

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={busy} className="ra-btn ra-btn-success ra-btn-sm">
        Mark paid
      </button>
      {open && (
        <div className="ra-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="ra-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="ra-h2" style={{ marginBottom: "0.5rem" }}>Mark batch paid?</h2>
            <p className="ra-quiet" style={{ marginBottom: "1.25rem" }}>
              Confirms that CEO Ministries has sent e-transfers totalling <strong>${total.toFixed(2)}</strong>.
              Every recipient on this batch gets a "payout sent" email.
            </p>
            <label className="ra-label">CEO Ministries reference (optional)</label>
            <input
              value={ref} onChange={(e) => setRef(e.target.value)}
              placeholder="e.g. CEO-2026-05-MAY" className="ra-input"
            />
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button className="ra-btn ra-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="ra-btn ra-btn-accent" onClick={run} disabled={busy}>
                {busy ? "…" : "Confirm paid"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

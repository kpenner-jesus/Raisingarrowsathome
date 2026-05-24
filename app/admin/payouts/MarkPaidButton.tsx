"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useToast } from "../_components/Toaster";

export default function MarkPaidButton({ batchId, total }: { batchId: string; total: number }) {
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [ref, setRef]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Esc closes (when not in-flight). Auto-focus input on open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const run = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/payouts/${batchId}/mark-paid`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ceo_reference: ref }),
    });
    setBusy(false);
    if (!res.ok) { notify(`Something went wrong: ${await res.text()}`, "error"); return; }
    const data = await res.json();
    setOpen(false);
    if (data.already_paid) {
      notify("This payout was already marked paid — no new emails sent");
    } else {
      notify(`Done. ${data.recipients_notified ?? 0} famil${(data.recipients_notified ?? 0) === 1 ? "y was" : "ies were"} emailed.`);
    }
    router.refresh();
  };

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={busy} className="ra-btn ra-btn-success ra-btn-sm">
        Mark as paid
      </button>
      {open && (
        <div className="ra-modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="ra-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="ra-h2" style={{ marginBottom: "0.5rem" }}>Tell families their money is on the way?</h2>
            <p className="ra-quiet" style={{ marginBottom: "1.25rem" }}>
              Click this once CEO Ministries has actually sent the e-transfers for this list
              (<strong>${total.toFixed(2)}</strong> total). Every family on the list gets a friendly
              email letting them know their money is coming.
            </p>
            <label className="ra-label">Reference number (optional, for your records)</label>
            <input
              ref={inputRef}
              value={ref} onChange={(e) => setRef(e.target.value)}
              placeholder="e.g. CEO-May-2026" className="ra-input"
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) run(); }}
              maxLength={120}
              disabled={busy}
            />
            <p className="ra-tiny" style={{ marginTop: "0.5rem" }}>
              Use whatever helps you track it later — an e-transfer confirmation number works well.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button className="ra-btn ra-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Not yet</button>
              <button className="ra-btn ra-btn-accent" onClick={run} disabled={busy}>
                {busy ? "Sending…" : "Yes, send emails"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

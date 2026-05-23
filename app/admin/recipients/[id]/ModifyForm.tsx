"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../../_components/Toaster";

interface Props {
  recipient: {
    id: string;
    approved_amount: number;
    reimbursement_rate: number;
    status: string;
    parent_names: string;
  };
}

export default function ModifyForm({ recipient }: Props) {
  const router = useRouter();
  const { notify } = useToast();
  const [cap, setCap]       = useState(Number(recipient.approved_amount));
  const [rate, setRate]     = useState(Number(recipient.reimbursement_rate));
  const [status, setStatus] = useState(recipient.status);
  const [busy, setBusy]     = useState(false);

  const dirty =
    cap    !== Number(recipient.approved_amount)    ||
    rate   !== Number(recipient.reimbursement_rate) ||
    status !== recipient.status;

  const submit = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/recipients/${recipient.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ approved_amount: cap, reimbursement_rate: rate, status }),
    });
    setBusy(false);
    if (!res.ok) {
      notify(`Failed: ${await res.text()}`, "error");
      return;
    }
    notify("Recipient updated");
    router.refresh();
  };

  return (
    <section className="ra-card" style={{ marginBottom: "1.5rem" }}>
      <h3 className="ra-section-title">
        Modify recipient
        {status === "suspended" && <span className="ra-badge ra-badge-suspended">Excluded from batches</span>}
        {status === "completed" && <span className="ra-badge ra-badge-completed">Excluded from batches</span>}
      </h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "1rem", alignItems: "end" }}>
        <div>
          <label className="ra-label">Cap (CAD)</label>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--ra-ink-muted)" }}>$</span>
            <input type="number" min="0" step="0.01" value={cap} onChange={(e) => setCap(parseFloat(e.target.value) || 0)} className="ra-input" style={{ paddingLeft: "1.5rem" }} />
          </div>
        </div>
        <div>
          <label className="ra-label">Reimbursement rate</label>
          <div className="ra-row" style={{ gap: "0.5rem", alignItems: "center" }}>
            <input
              type="range" min="0" max="1" step="0.05" value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: "var(--ra-accent)" }}
            />
            <span style={{ fontFamily: "var(--font-display)", fontSize: "1rem", width: 42, textAlign: "right" }}>
              {(rate * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div>
          <label className="ra-label">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="ra-select">
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="completed">completed</option>
          </select>
        </div>
        <button disabled={busy || !dirty} onClick={submit} className="ra-btn ra-btn-primary">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

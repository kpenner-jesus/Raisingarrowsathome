"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  recipient: {
    id: string;
    approved_amount: number;
    reimbursement_rate: number;
    status: string;
  };
}

export default function ModifyForm({ recipient }: Props) {
  const router = useRouter();
  const [cap,    setCap]    = useState(Number(recipient.approved_amount));
  const [rate,   setRate]   = useState(Number(recipient.reimbursement_rate));
  const [status, setStatus] = useState(recipient.status);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState("");
  const [ok,     setOk]     = useState(false);

  const dirty =
    cap    !== Number(recipient.approved_amount)    ||
    rate   !== Number(recipient.reimbursement_rate) ||
    status !== recipient.status;

  const submit = async () => {
    setBusy(true); setError(""); setOk(false);
    const res = await fetch(`/api/admin/recipients/${recipient.id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ approved_amount: cap, reimbursement_rate: rate, status }),
    });
    setBusy(false);
    if (!res.ok) { setError(await res.text()); return; }
    setOk(true);
    router.refresh();
    setTimeout(() => setOk(false), 2000);
  };

  return (
    <div style={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 10, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "#888", fontWeight: 700, letterSpacing: "0.1em", marginBottom: "1rem" }}>
        Modify recipient
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "1rem" }}>
        <div>
          <label style={lbl}>Approved cap ($CAD)</label>
          <input type="number" step="0.01" min="0" value={cap} onChange={(e) => setCap(parseFloat(e.target.value) || 0)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Reimbursement rate (0–1)</label>
          <input type="number" step="0.05" min="0" max="1" value={rate} onChange={(e) => setRate(parseFloat(e.target.value) || 0)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="completed">completed</option>
          </select>
        </div>
      </div>

      {error && <div className="tf-alert-error" style={{ marginTop: "0.75rem" }}>{error}</div>}
      {ok    && <div style={{ marginTop: "0.75rem", padding: "0.5rem 0.875rem", background: "#3a9e6e22", color: "#3a9e6e", borderRadius: 6, fontSize: "0.85rem" }}>Saved.</div>}

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginTop: "1rem" }}>
        <button disabled={busy || !dirty} onClick={submit} className="tf-ok" style={{ padding: "0.55rem 1.25rem", fontSize: "0.85rem" }}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        {status === "suspended" && <span style={{ fontSize: "0.78rem", color: "#e05050" }}>Suspended recipients are excluded from payout batches.</span>}
        {status === "completed" && <span style={{ fontSize: "0.78rem", color: "#888" }}>Completed recipients are excluded from payout batches.</span>}
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: "0.7rem", textTransform: "uppercase", color: "#888", letterSpacing: "0.08em", marginBottom: "0.35rem", fontWeight: 600 };
const inp: React.CSSProperties = { width: "100%", padding: "0.55rem 0.75rem", border: "1px solid #ddd", borderRadius: 6, fontSize: "0.9rem", fontFamily: "var(--font-body)" };

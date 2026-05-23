"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DecisionForm({ applicationId, defaultCap, adminNotes }: {
  applicationId: string;
  defaultCap: number;
  adminNotes: string;
}) {
  const router = useRouter();
  const [cap, setCap]   = useState(defaultCap);
  const [rate, setRate] = useState(0.75);
  const [notes, setNotes] = useState(adminNotes);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");

  const submit = async (decision: "approved" | "denied") => {
    setBusy(true); setError("");
    const res = await fetch(`/api/admin/applications/${applicationId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, approved_amount: cap, rate, notes }),
    });
    setBusy(false);
    if (!res.ok) { setError(await res.text()); return; }
    router.refresh();
  };

  return (
    <div>
      <label style={lbl}>Approved cap ($CAD)</label>
      <input type="number" value={cap} onChange={(e) => setCap(parseFloat(e.target.value) || 0)} style={inp} />

      <label style={lbl}>Reimbursement rate (0.0 – 1.0)</label>
      <input type="number" step="0.05" min="0" max="1" value={rate} onChange={(e) => setRate(parseFloat(e.target.value) || 0)} style={inp} />

      <label style={lbl}>Admin notes</label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inp, resize: "vertical" }} />

      {error && <div className="tf-alert-error" style={{ marginTop: "0.75rem" }}>{error}</div>}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <button disabled={busy} onClick={() => submit("approved")} className="tf-ok" style={{ flex: 1 }}>Approve</button>
        <button disabled={busy} onClick={() => submit("denied")}   style={denyBtn}>Deny</button>
      </div>
      <p style={{ fontSize: "0.72rem", color: "#888", marginTop: "0.75rem", lineHeight: 1.5 }}>
        Approving creates a recipient and emails them a magic sign-in link to the portal.
      </p>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: "0.72rem", textTransform: "uppercase", color: "#888", letterSpacing: "0.08em", marginTop: "0.75rem", marginBottom: "0.35rem", fontWeight: 600 };
const inp: React.CSSProperties = { width: "100%", padding: "0.55rem 0.75rem", border: "1px solid #ddd", borderRadius: 6, fontSize: "0.9rem", fontFamily: "var(--font-body)" };
const denyBtn: React.CSSProperties = { flex: 1, padding: "0.75rem", border: "1px solid #e05050", color: "#e05050", background: "white", borderRadius: 100, fontFamily: "var(--font-body)", cursor: "pointer", fontSize: "0.85rem" };

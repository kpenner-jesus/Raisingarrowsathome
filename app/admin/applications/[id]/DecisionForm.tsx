"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../../_components/Toaster";
import { ConfirmModal } from "../../_components/ConfirmModal";

export default function DecisionForm({ applicationId, defaultCap, adminNotes, parentNames }: {
  applicationId: string;
  defaultCap: number;
  adminNotes: string;
  parentNames: string;
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [cap, setCap]   = useState(defaultCap);
  const [rate, setRate] = useState(0.75);
  const [notes, setNotes] = useState(adminNotes);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<null | "approved" | "denied">(null);

  const submit = async (decision: "approved" | "denied") => {
    setBusy(true); setError("");
    const res = await fetch(`/api/admin/applications/${applicationId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, approved_amount: cap, rate, notes }),
    });
    setBusy(false);
    setConfirm(null);
    if (!res.ok) {
      const text = await res.text();
      setError(text);
      notify(`Failed: ${text}`, "error");
      return;
    }
    notify(decision === "approved" ? `Approved ${parentNames}` : `Denied ${parentNames}`);
    router.refresh();
  };

  return (
    <>
      <div>
        <label className="ra-label">Approved cap (CAD)</label>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: "0.85rem", top: "50%", transform: "translateY(-50%)", color: "var(--ra-ink-muted)", fontSize: "0.95rem" }}>$</span>
          <input
            type="number" min="0" step="0.01" value={cap}
            onChange={(e) => setCap(parseFloat(e.target.value) || 0)}
            className="ra-input" style={{ paddingLeft: "1.65rem" }}
          />
        </div>
        <div className="ra-tiny" style={{ marginTop: "0.35rem" }}>
          Default ${defaultCap} (sum of age-tier caps)
        </div>

        <label className="ra-label" style={{ marginTop: "1rem" }}>Reimbursement rate</label>
        <div className="ra-row" style={{ gap: "0.6rem", alignItems: "center" }}>
          <input
            type="range" min="0" max="1" step="0.05" value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: "var(--ra-accent)" }}
          />
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", width: 48, textAlign: "right" }}>
            {(rate * 100).toFixed(0)}%
          </span>
        </div>

        <label className="ra-label" style={{ marginTop: "1rem" }}>Notes (sent to applicant on denial)</label>
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="ra-textarea"
          placeholder="Optional notes, e.g. specific feedback or context…"
        />

        {error && <div className="ra-alert ra-alert-error" style={{ marginTop: "0.75rem" }}>{error}</div>}

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem" }}>
          <button disabled={busy} onClick={() => setConfirm("approved")} className="ra-btn ra-btn-accent" style={{ flex: 1 }}>
            Approve
          </button>
          <button disabled={busy} onClick={() => setConfirm("denied")}   className="ra-btn ra-btn-danger" style={{ flex: 1 }}>
            Deny
          </button>
        </div>
        <p className="ra-tiny" style={{ marginTop: "0.75rem", lineHeight: 1.5 }}>
          Approving creates a recipient and emails them a portal sign-in link.
        </p>
      </div>

      <ConfirmModal
        open={confirm !== null}
        title={confirm === "approved" ? `Approve ${parentNames}?` : `Deny ${parentNames}?`}
        body={
          confirm === "approved"
            ? `Cap $${cap.toFixed(2)} · ${(rate * 100).toFixed(0)}% reimbursement. The applicant gets an email + portal access.`
            : `The applicant is notified by email. Notes (if any) are included.`
        }
        confirmLabel={confirm === "approved" ? "Approve" : "Deny"}
        destructive={confirm === "denied"}
        busy={busy}
        onConfirm={() => confirm && submit(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

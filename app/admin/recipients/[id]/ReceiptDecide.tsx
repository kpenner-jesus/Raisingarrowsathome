"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../../_components/Toaster";

interface Props {
  id: string;
  amount: number;
  currency: "CAD" | "USD";
  rate: number;
  description?: string;
}

export default function ReceiptDecide({ id, amount, currency, rate, description }: Props) {
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<null | "approved" | "rejected">(null);
  const defaultReimbursable = currency === "CAD" ? Number((amount * rate).toFixed(2)) : "";
  const [reimbursable, setReimbursable] = useState<string | number>(defaultReimbursable);
  const [rejectNotes, setRejectNotes] = useState("");

  const decide = async () => {
    if (!open) return;
    setBusy(true);
    const body: any = { decision: open };
    if (open === "approved") body.reimbursable_amount = reimbursable;
    if (open === "rejected") body.notes = rejectNotes;
    const res = await fetch(`/api/admin/receipts/${id}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) { notify(`Failed: ${await res.text()}`, "error"); return; }
    notify(open === "approved" ? "Receipt approved" : "Receipt rejected");
    setOpen(null);
    router.refresh();
  };

  return (
    <>
      <span style={{ display: "inline-flex", gap: 4 }}>
        <button disabled={busy} onClick={() => setOpen("approved")} className="ra-btn ra-btn-icon ra-btn-success" title="Approve receipt" aria-label="Approve">
          ✓
        </button>
        <button disabled={busy} onClick={() => setOpen("rejected")} className="ra-btn ra-btn-icon ra-btn-danger" title="Reject receipt" aria-label="Reject">
          ×
        </button>
      </span>

      {open && (
        <div className="ra-modal-backdrop" onClick={() => !busy && setOpen(null)}>
          <div className="ra-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="ra-h2" style={{ marginBottom: "0.5rem" }}>
              {open === "approved" ? "Approve receipt" : "Reject receipt"}
            </h2>
            <p className="ra-quiet" style={{ marginBottom: "1rem" }}>
              <strong>{currency} ${amount.toFixed(2)}</strong>{description ? ` · ${description}` : ""}
            </p>

            {open === "approved" ? (
              <>
                <label className="ra-label">Reimbursable amount (CAD)</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: "0.85rem", top: "50%", transform: "translateY(-50%)", color: "var(--ra-ink-muted)" }}>$</span>
                  <input
                    type="number" min="0" step="0.01" value={reimbursable}
                    onChange={(e) => setReimbursable(e.target.value)}
                    className="ra-input" style={{ paddingLeft: "1.65rem" }}
                    autoFocus
                    placeholder={currency === "USD" ? "Required for USD" : ""}
                  />
                </div>
                <div className="ra-tiny" style={{ marginTop: "0.4rem", lineHeight: 1.5 }}>
                  {currency === "CAD"
                    ? `Default: ${(rate * 100).toFixed(0)}% of receipt = $${(amount * rate).toFixed(2)}. Adjust if reimbursing a different amount (e.g. shared shipping costs).`
                    : `USD receipt — enter the CAD amount you'll reimburse. No exchange rate auto-conversion.`}
                </div>
              </>
            ) : (
              <>
                <label className="ra-label">Reason (sent to recipient)</label>
                <textarea
                  value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)}
                  rows={3} className="ra-textarea"
                  placeholder="e.g. This looks like a field trip — only curriculum, workbooks, and educational books are eligible."
                  autoFocus
                />
              </>
            )}

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button className="ra-btn ra-btn-ghost" onClick={() => setOpen(null)} disabled={busy}>Cancel</button>
              <button
                className={`ra-btn ${open === "approved" ? "ra-btn-success" : "ra-btn-danger"}`}
                onClick={decide}
                disabled={busy || (open === "approved" && (reimbursable === "" || Number(reimbursable) < 0))}
              >
                {busy ? "…" : (open === "approved" ? "Approve" : "Reject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

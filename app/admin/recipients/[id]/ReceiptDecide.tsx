"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../../_components/Toaster";
import { ConfirmModal } from "../../_components/ConfirmModal";

export default function ReceiptDecide({ id, amount, description }: { id: string; amount: number; description?: string }) {
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "approved" | "rejected">(null);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    const res = await fetch(`/api/admin/receipts/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusy(false);
    setConfirm(null);
    if (!res.ok) {
      const text = await res.text();
      notify(`Failed: ${text}`, "error");
      return;
    }
    notify(decision === "approved" ? "Receipt approved" : "Receipt rejected");
    router.refresh();
  };

  return (
    <>
      <span style={{ display: "inline-flex", gap: 4 }}>
        <button disabled={busy} onClick={() => setConfirm("approved")} className="ra-btn ra-btn-icon ra-btn-success" title="Approve receipt" aria-label="Approve">
          ✓
        </button>
        <button disabled={busy} onClick={() => setConfirm("rejected")} className="ra-btn ra-btn-icon ra-btn-danger" title="Reject receipt" aria-label="Reject">
          ×
        </button>
      </span>
      <ConfirmModal
        open={confirm !== null}
        title={confirm === "approved" ? "Approve receipt?" : "Reject receipt?"}
        body={`$${amount.toFixed(2)}${description ? " · " + description : ""}. Recipient gets an email either way.`}
        confirmLabel={confirm === "approved" ? "Approve" : "Reject"}
        destructive={confirm === "rejected"}
        busy={busy}
        onConfirm={() => confirm && decide(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

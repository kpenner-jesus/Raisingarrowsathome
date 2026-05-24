"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteDraftButton({ batchId, total, scheduledDate }: {
  batchId: string;
  total: number;
  scheduledDate: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    const ok = confirm(
      `Throw away this draft list?\n\n` +
      `Date: ${scheduledDate}\n` +
      `Total: $${total.toFixed(2)}\n\n` +
      `The list and the planned payouts inside it go away. ` +
      `The approved receipts stay safe — you can make a new list anytime. ` +
      `This action is saved in the records. You cannot undo it.`
    );
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/admin/payouts/${batchId}/delete-draft`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || "Failed");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ra-btn"
        onClick={go}
        disabled={busy}
        title="Throw away this draft list and start over"
        style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem", color: "var(--ra-danger)", borderColor: "var(--ra-danger)" }}
      >
        {busy ? "…" : "Throw away"}
      </button>
      {err && <div className="ra-tiny" style={{ color: "var(--ra-danger)", marginTop: 4 }}>{err}</div>}
    </>
  );
}

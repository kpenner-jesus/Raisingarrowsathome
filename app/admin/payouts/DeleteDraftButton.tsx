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
      `Delete this draft batch?\n\n` +
      `Date: ${scheduledDate}\n` +
      `Total: $${total.toFixed(2)}\n\n` +
      `Removes the batch row + every scheduled payout in it. ` +
      `Approved receipts stay intact and will become eligible again ` +
      `on the next generate. Action is audit-logged. No undo.`
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
        title="Delete this draft batch and its scheduled payouts"
        style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem", color: "var(--ra-danger)", borderColor: "var(--ra-danger)" }}
      >
        {busy ? "…" : "Delete draft"}
      </button>
      {err && <div className="ra-tiny" style={{ color: "var(--ra-danger)", marginTop: 4 }}>{err}</div>}
    </>
  );
}

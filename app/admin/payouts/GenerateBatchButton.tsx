"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "../_components/Toaster";
import { ConfirmModal } from "../_components/ConfirmModal";

export default function GenerateBatchButton() {
  const router = useRouter();
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const run = async () => {
    setBusy(true);
    const res = await fetch("/api/admin/payouts/generate", { method: "POST" });
    setBusy(false);
    setConfirm(false);
    if (!res.ok) { notify(`Failed: ${await res.text()}`, "error"); return; }
    const data = await res.json();
    notify(`Batch generated — ${data.lines} recipient(s), $${data.total.toFixed(2)}`);
    router.refresh();
  };

  return (
    <>
      <button onClick={() => setConfirm(true)} disabled={busy} className="ra-btn ra-btn-accent">
        {busy ? "Working…" : "+ Make a payout list"}
      </button>
      <ConfirmModal
        open={confirm}
        title="Get ready to pay families?"
        body="This makes a draft list of money owed to each family right now. Nothing is sent yet and no emails go out. You'll review the list, send it to CEO Ministries, and then come back to mark it paid once the e-transfers go out."
        confirmLabel="Make the list"
        busy={busy}
        onConfirm={run}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}

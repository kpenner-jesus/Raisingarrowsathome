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
        {busy ? "Generating…" : "+ Generate batch now"}
      </button>
      <ConfirmModal
        open={confirm}
        title="Generate a new payout batch?"
        body="This adds a draft batch with every recipient currently eligible. Same logic as the monthly cron — no emails sent until you mark it paid."
        confirmLabel="Generate"
        busy={busy}
        onConfirm={run}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}

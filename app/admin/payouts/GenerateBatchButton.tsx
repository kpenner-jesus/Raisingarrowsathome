"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function GenerateBatchButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!confirm("Generate a payout batch now from all currently eligible recipients?")) return;
    setBusy(true);
    const res = await fetch("/api/admin/payouts/generate", { method: "POST" });
    setBusy(false);
    if (!res.ok) { alert(await res.text()); return; }
    router.refresh();
  };

  return (
    <button onClick={run} disabled={busy} className="tf-ok" style={{ padding: "0.6rem 1.25rem", fontSize: "0.85rem" }}>
      {busy ? "Generating…" : "Generate batch now"}
    </button>
  );
}

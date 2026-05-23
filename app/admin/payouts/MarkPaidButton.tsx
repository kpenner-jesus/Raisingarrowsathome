"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MarkPaidButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const ceo_reference = prompt("CEO Ministries reference number (optional)") || "";
    if (!confirm("Confirm — has CEO Ministries actually paid this batch?")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/payouts/${batchId}/mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ceo_reference }),
    });
    setBusy(false);
    if (!res.ok) { alert(await res.text()); return; }
    router.refresh();
  };

  return (
    <button onClick={run} disabled={busy} style={{
      background: "white", color: "#3a9e6e", border: "1px solid #3a9e6e",
      borderRadius: 4, padding: "2px 8px", fontSize: "0.78rem", cursor: "pointer",
    }}>
      {busy ? "…" : "Mark paid"}
    </button>
  );
}

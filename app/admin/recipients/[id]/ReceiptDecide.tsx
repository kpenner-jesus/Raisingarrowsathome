"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReceiptDecide({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    await fetch(`/api/admin/receipts/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusy(false);
    router.refresh();
  };

  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <button disabled={busy} onClick={() => decide("approved")} style={btn("#3a9e6e")} title="Approve">✓</button>
      <button disabled={busy} onClick={() => decide("rejected")} style={btn("#e05050")} title="Reject">×</button>
    </span>
  );
}

const btn = (c: string): React.CSSProperties => ({
  background: c,
  color: "white",
  border: "none",
  borderRadius: 4,
  width: 26,
  height: 26,
  cursor: "pointer",
  fontSize: "1rem",
  fontWeight: 600,
  lineHeight: 1,
});

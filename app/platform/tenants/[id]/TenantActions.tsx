"use client";
// Super-admin only. Buttons to flip a tenant's status — pause, resume, etc.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TenantActions({ orgId, currentStatus }: { orgId: string; currentStatus: string }) {
  const router = useRouter();
  const [busy, setBusy]   = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: string) {
    if (!confirm(`Set status to "${next}"? Tenant pages will reflect this on the next request.`)) return;
    setBusy(next); setError(null);
    try {
      const r = await fetch("/api/platform/tenant-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, status: next }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed");
    } finally {
      setBusy(null);
    }
  }

  const btn = (label: string, next: string, accent: string, disabled = false) => (
    <button
      key={next}
      onClick={() => setStatus(next)}
      disabled={!!busy || disabled || next === currentStatus}
      style={{
        padding: "0.6rem 1rem",
        borderRadius: 8,
        border: `1px solid ${accent}`,
        background: next === currentStatus ? "rgba(255,255,255,0.04)" : "transparent",
        color: accent,
        fontSize: "0.88rem",
        fontWeight: 600,
        cursor: (busy || disabled || next === currentStatus) ? "not-allowed" : "pointer",
        opacity: (disabled || next === currentStatus) ? 0.45 : 1,
      }}
    >
      {busy === next ? "…" : label}
    </button>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {btn("Resume → active", "active",   "#7cd5a8")}
        {btn("Pause portal",    "paused",   "#f0a070")}
        {btn("Mark canceled",   "canceled", "#ff8888")}
      </div>
      {error && (
        <div style={{ marginTop: "0.6rem", color: "#ff8888", fontSize: "0.85rem" }}>{error}</div>
      )}
      <p style={{ marginTop: "0.6rem", fontSize: "0.78rem", color: "rgba(255,255,255,0.5)", lineHeight: 1.55 }}>
        Pause hides the tenant's public pages without canceling Stripe billing.
        For a real cancellation, also stop the subscription via the Stripe dashboard.
      </p>
    </div>
  );
}

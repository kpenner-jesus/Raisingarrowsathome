"use client";
// Sticky banner shown at the very top of every portal page while
// the admin is impersonating the test grantee. Single click on
// "Back to admin" stops impersonation and returns to /admin.

import { useState } from "react";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export function ImpersonationBanner() {
  const [busy, setBusy] = useState(false);
  if (typeof window === "undefined") return null;
  // Cookie is set by /api/admin/impersonate as non-httpOnly so the
  // client can detect impersonation state without an API round-trip.
  const active = !!readCookie("ra_impersonate");
  if (!active) return null;

  async function stop() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      // Even on transient failure, navigate to /admin — the cookie may
      // already be cleared and stale UI is worse than a refresh.
      window.location.href = "/admin";
    } catch {
      window.location.href = "/admin";
    }
  }

  return (
    <div
      role="status"
      aria-label="Test grantee impersonation banner"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        width: "100%",
        background: "linear-gradient(90deg, #b75cff 0%, #8e3ad0 100%)",
        color: "#fff",
        padding: "0.55rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.85rem",
        fontFamily: "var(--font-body)",
        fontSize: "0.85rem",
        fontWeight: 500,
        boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
        flexWrap: "wrap",
        textAlign: "center",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "1.1rem" }}>🎭</span>
        <strong>Impersonating test grantee.</strong>
        <span style={{ opacity: 0.85, fontWeight: 400 }}>
          Nothing here is real — it's a sandbox.
        </span>
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={busy}
        style={{
          background: "rgba(255,255,255,0.18)",
          border: "1px solid rgba(255,255,255,0.35)",
          color: "#fff",
          padding: "0.3rem 0.85rem",
          borderRadius: 100,
          fontSize: "0.82rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {busy ? "…" : "← Back to admin"}
      </button>
    </div>
  );
}

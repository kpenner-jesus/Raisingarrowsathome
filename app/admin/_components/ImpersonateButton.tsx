"use client";
// Admin-side toggle: "View as test grantee" / "Stop impersonating".
//
// State is derived from a non-httpOnly cookie `ra_impersonate` so we can
// tell at render time whether we're already in impersonation mode. The
// actual toggle goes through POST /api/admin/impersonate which sets/clears
// the cookie server-side (and on START, wipes the test recipient's data).
//
// IMPORTANT: feature must be gated to non-prod deploys at the call site;
// the button itself doesn't enforce that — it only refuses to fire on prod
// as a defence-in-depth check.

import { useState } from "react";
import { useRouter } from "next/navigation";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export function ImpersonateButton({ variant = "default" }: { variant?: "default" | "compact" | "sidebar" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const env = process.env.NEXT_PUBLIC_ENV;
  if (env === "production") return null; // hard hide on prod

  // Client-side read: whether we're currently impersonating.
  const active = typeof window !== "undefined" && !!readCookie("ra_impersonate");

  async function toggle(action: "start" | "stop") {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      // On START → navigate to portal to immediately see the test-grantee view.
      // On STOP  → reload current route so admin UI re-renders.
      if (action === "start") {
        window.location.href = "/portal";
      } else {
        router.refresh();
      }
    } catch (e: any) {
      setError(e?.message || "Failed");
      setBusy(false);
    }
  }

  const sharedStyle: React.CSSProperties = {
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    transition: "transform 0.06s, background 0.15s",
  };

  if (active) {
    // Currently impersonating → "Stop" button (red-ish).
    return (
      <button
        type="button"
        onClick={() => toggle("stop")}
        disabled={busy}
        className="ra-btn"
        style={{
          ...sharedStyle,
          background: "#fce8e8",
          border: "1px solid #a83232",
          color: "#a83232",
          fontWeight: 600,
        }}
        title="Stop impersonating the test grantee"
      >
        🎭 {busy ? "…" : "Stop test mode"}
      </button>
    );
  }

  // Not impersonating → confirm-first button
  if (variant === "sidebar") {
    return (
      <>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          style={{
            ...sharedStyle,
            background: "transparent",
            border: "1px dashed rgba(255,255,255,0.25)",
            color: "rgba(255,255,255,0.75)",
            borderRadius: 8,
            padding: "0.5rem 0.7rem",
            fontSize: "0.78rem",
            width: "100%",
            textAlign: "left",
          }}
        >
          🎭 View as test grantee
        </button>
        {confirmOpen && <ConfirmDialog
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => { setConfirmOpen(false); toggle("start"); }}
          busy={busy}
          error={error}
        />}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
        className="ra-btn"
        style={{
          ...sharedStyle,
          background: "linear-gradient(135deg, #b75cff, #8e3ad0)",
          color: "#fff",
          border: "none",
          fontWeight: 600,
        }}
      >
        🎭 View as test grantee
      </button>
      {confirmOpen && <ConfirmDialog
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); toggle("start"); }}
        busy={busy}
        error={error}
      />}
    </>
  );
}

function ConfirmDialog({
  onCancel, onConfirm, busy, error,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div
      onClick={() => !busy && onCancel()}
      style={{
        position: "fixed", inset: 0, background: "rgba(20,16,12,0.55)",
        zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem",
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, padding: "1.5rem", maxWidth: 480, width: "100%",
      }}>
        <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)", fontSize: "1.25rem" }}>
          Switch to test grantee view?
        </h3>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.55, fontSize: "0.92rem" }}>
          You'll be sent to the recipient portal as a sample family. Any receipts, photos,
          or testimonials currently on the test recipient will be <strong>wiped clean</strong>.
        </p>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.55, fontSize: "0.88rem" }}>
          Any emails the test grantee receives (payout notifications, etc) will be sent
          to <strong>your</strong> email so you can verify them.
        </p>
        {error && <div className="ra-alert-error" style={{ marginTop: "0.5rem" }}>{error}</div>}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
          <button className="ra-btn" disabled={busy} onClick={onCancel}>Cancel</button>
          <button
            className="ra-btn"
            disabled={busy}
            onClick={onConfirm}
            style={{
              background: "linear-gradient(135deg, #b75cff, #8e3ad0)",
              color: "#fff", border: "none", fontWeight: 600,
            }}
          >
            {busy ? "Setting up…" : "Yes, switch to portal view"}
          </button>
        </div>
      </div>
    </div>
  );
}

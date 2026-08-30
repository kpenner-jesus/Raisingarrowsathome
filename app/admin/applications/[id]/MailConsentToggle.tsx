"use client";

// Small control so an admin can act on "please stop sending me mail".
// The application form promises that; without this it could not be honoured.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MailConsentToggle({ id, consent }: { id: string; consent: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/admin/applications/${id}/mail-consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: next }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error || `Failed (${r.status})`);
      } else {
        router.refresh();
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    }
    setBusy(false);
  }

  return (
    <div style={{ marginTop: "0.35rem" }}>
      <button
        className="ra-btn"
        onClick={() => set(!consent)}
        disabled={busy}
        style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem" }}
      >
        {busy ? "Saving…" : consent ? "Record: stop sending mail" : "Record: happy to receive mail"}
      </button>
      {error && <div className="ra-alert-error" style={{ marginTop: "0.4rem", fontSize: "0.8rem" }}>{error}</div>}
    </div>
  );
}

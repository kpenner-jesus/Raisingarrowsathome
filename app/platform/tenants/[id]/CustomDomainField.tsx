"use client";
// Super-admin only. Set (or clear) the web address a charity uses for their
// own portal, e.g. grants.cedarchurch.org.
//
// Deliberately says out loud that saving this is only step one — the domain
// still has to be attached in the hosting dashboard and added to the Supabase
// Auth redirect allowlist. Skipping that last step is the trap: everything
// looks configured, and every sign-in link on the domain fails silently.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CustomDomainField({
  orgId,
  currentDomain,
}: {
  orgId: string;
  currentDomain: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentDomain ?? "");
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);

  const dirty = value.trim() !== (currentDomain ?? "");

  async function save() {
    const clearing = value.trim().length === 0;
    if (clearing && currentDomain) {
      if (!confirm(`Remove ${currentDomain}? Requests to it will stop resolving to this charity.`)) return;
    }
    setBusy(true); setError(null); setSteps([]);
    try {
      const r = await fetch("/api/platform/custom-domain", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, domain: value.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setSteps(j.next_steps ?? []);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); setSteps([]); }}
          onKeyDown={(e) => { if (e.key === "Enter" && dirty && !busy) save(); }}
          placeholder="grants.cedarchurch.org"
          spellCheck={false}
          autoCapitalize="off"
          style={{
            flex: "1 1 260px", padding: "0.55rem 0.7rem", borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.25)",
            color: "#fff", fontFamily: "ui-monospace, monospace", fontSize: "0.85rem",
          }}
        />
        <button
          onClick={save}
          disabled={busy || !dirty}
          style={{
            padding: "0.55rem 1rem", borderRadius: 8,
            border: "1px solid #e8793a", background: "transparent", color: "#e8793a",
            fontSize: "0.85rem", fontWeight: 600,
            cursor: busy || !dirty ? "not-allowed" : "pointer",
            opacity: busy || !dirty ? 0.45 : 1,
          }}
        >
          {busy ? "Saving…" : value.trim() ? "Save" : "Clear"}
        </button>
      </div>

      <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.45)", margin: "0.5rem 0 0" }}>
        Just the hostname — no <code>https://</code>, port or trailing slash. Leave empty to remove.
      </p>

      {error && (
        <p style={{ fontSize: "0.8rem", color: "#ff9b8a", margin: "0.5rem 0 0" }}>{error}</p>
      )}

      {steps.length > 0 && (
        <div style={{
          margin: "0.75rem 0 0", padding: "0.7rem 0.85rem", borderRadius: 8,
          background: "rgba(232,121,58,0.12)", border: "1px solid rgba(232,121,58,0.35)",
        }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e8793a", marginBottom: "0.35rem" }}>
            Saved — but it won&rsquo;t work until you also:
          </div>
          <ol style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8rem", color: "rgba(255,255,255,0.75)", lineHeight: 1.55 }}>
            {steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

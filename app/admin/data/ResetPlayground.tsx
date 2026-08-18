"use client";

// The erase button. Two deliberate barriers before anything is deleted:
//
//   1. A summary of exactly what will go, with real counts pulled from the
//      database — not a generic "are you sure?". You have to read the number
//      of applications and receipts you are about to lose.
//   2. Typing the phrase by hand. No pre-filled value, no copy button; the
//      Erase button stays disabled until it matches exactly.
//
// The server re-checks the phrase and every other gate independently, so none
// of this is load-bearing for safety — it is here to stop an honest mistake.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Info = {
  available: boolean;
  reason?: string;
  phrase?: string;
  counts?: Record<string, number>;
  total?: number;
};

const LABELS: Record<string, string> = {
  applications: "Applications",
  recipients: "Approved families",
  receipts: "Receipts",
  photos: "Photos",
  payouts: "Payouts",
  payout_batches: "Payout batches",
  testimonials: "Testimonials",
  broadcasts: "Broadcasts",
  broadcast_sends: "Broadcast recipients",
  email_events: "Email log entries",
  email_optouts: "Unsubscribes",
  audit_log: "Audit log entries",
  application_notes: "Notes on applications",
  recipient_notes: "Notes on families",
  submit_throttle: "Rate-limit counters",
};

export function ResetPlayground() {
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/staging-reset")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ available: false, reason: "could not check" }));
  }, []);

  // Not a practice environment → render nothing at all. The API refuses
  // independently; this just keeps the button off the real site entirely.
  if (!info || !info.available) return null;

  const phrase = info.phrase ?? "";
  const counts = info.counts ?? {};
  const rows = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = info.total ?? 0;

  async function erase() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/staging-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error || `Failed (${res.status})`);
        setBusy(false);
        return;
      }
      setResult(`Erased ${j.rows_deleted ?? 0} records and ${Object.values(j.files_removed ?? {}).reduce((s: number, n: any) => s + Number(n || 0), 0)} uploaded files. The playground is clean.`);
      setStep(0);
      setTyped("");
      setBusy(false);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div style={{
      marginTop: "1.75rem",
      border: "1.5px solid rgba(190,60,60,0.35)",
      background: "rgba(190,60,60,0.04)",
      borderRadius: 14,
      padding: "1.15rem 1.25rem",
    }}>
      <div style={{ fontWeight: 600, marginBottom: "0.3rem", color: "#a12b2b" }}>
        Practice area — erase everything and start clean
      </div>
      <p className="ra-quiet" style={{ fontSize: "0.84rem", lineHeight: 1.6, margin: "0 0 0.9rem" }}>
        This is the practice site, so nothing here is real. Erasing wipes the applications,
        families, receipts, photos and payouts so you can start testing from scratch.
        Your sign-in, your team, and your settings are left alone.
      </p>

      {result && (
        <div className="ra-alert-success" style={{ marginBottom: "0.9rem" }}>{result}</div>
      )}
      {error && (
        <div className="ra-alert-error" style={{ marginBottom: "0.9rem" }}>{error}</div>
      )}

      {step === 0 && (
        <button className="ra-btn" onClick={() => setStep(1)}
          style={{ borderColor: "rgba(190,60,60,0.5)", color: "#a12b2b" }}>
          Erase all practice data
        </button>
      )}

      {/* Barrier 1 — show them exactly what disappears */}
      {step === 1 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.5rem" }}>
            This will permanently delete:
          </div>
          {rows.length === 0 ? (
            <p className="ra-quiet" style={{ fontSize: "0.85rem" }}>
              Nothing to erase — the playground is already empty.
            </p>
          ) : (
            <ul style={{ fontSize: "0.86rem", lineHeight: 1.7, margin: "0 0 0.9rem", paddingLeft: "1.1rem" }}>
              {rows.map(([t, n]) => (
                <li key={t}><strong>{n.toLocaleString()}</strong> {LABELS[t] ?? t}</li>
              ))}
            </ul>
          )}
          <p className="ra-quiet" style={{ fontSize: "0.82rem", margin: "0 0 0.9rem" }}>
            {total.toLocaleString()} records in total, plus every uploaded receipt and photo.
            This cannot be undone.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="ra-btn" onClick={() => setStep(2)} disabled={rows.length === 0}
              style={{ borderColor: "rgba(190,60,60,0.5)", color: "#a12b2b" }}>
              Yes, continue
            </button>
            <button className="ra-btn" onClick={() => { setStep(0); setTyped(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Barrier 2 — type it out */}
      {step === 2 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.4rem" }}>
            Last check. Type <code>{phrase}</code> to confirm.
          </div>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={phrase}
            autoComplete="off"
            spellCheck={false}
            style={{
              width: "100%", maxWidth: 340, padding: "0.55rem 0.75rem",
              border: "1.5px solid rgba(0,0,0,0.15)", borderRadius: 8,
              fontFamily: "monospace", marginBottom: "0.75rem",
            }}
          />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              className="ra-btn"
              onClick={erase}
              disabled={typed !== phrase || busy}
              style={typed === phrase && !busy
                ? { background: "#a12b2b", borderColor: "#a12b2b", color: "#fff" }
                : undefined}
            >
              {busy ? "Erasing…" : "Erase everything"}
            </button>
            <button className="ra-btn" onClick={() => { setStep(0); setTyped(""); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
// One row in Recent broadcasts, with the thing that was missing entirely:
// what state it's in, how far it got, and a way to finish it.
//
// Before this, the table showed only "Sent" and "Failed" counts with no
// denominator and no state — so a broadcast stranded halfway looked exactly
// like a delivered one, and the operator's only move was to send it again.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deriveBroadcastStatus, type BroadcastStatus } from "@/app/lib/broadcast-logic";

export interface BroadcastRowData {
  id: string;
  subject: string;
  audience: string;
  created_at: string;
  created_label: string;
  sent_by_email: string | null;
  state: string;
  scheduled_for: string | null;
  materialized_at: string | null;
  progress_at: string | null;
  total_count: number | null;
  sent: number;
  failed: number;
  pending: number;
}

const TONE: Record<BroadcastStatus["tone"], { bg: string; fg: string }> = {
  neutral:  { bg: "rgba(0,0,0,0.06)",       fg: "#555" },
  progress: { bg: "rgba(42,111,176,0.12)",  fg: "#2a6fb0" },
  good:     { bg: "rgba(58,158,110,0.12)",  fg: "#2f7d59" },
  warn:     { bg: "rgba(232,121,58,0.14)",  fg: "#a5561c" },
  bad:      { bg: "rgba(192,57,43,0.12)",   fg: "#a5281c" },
};

export function BroadcastRow({ row, nowMs: serverNow }: { row: BroadcastRowData; nowMs: number }) {
  const router = useRouter();
  const [live, setLive] = useState({ sent: row.sent, failed: row.failed, pending: row.pending, total: row.total_count });
  const [state, setState] = useState(row.state);
  const [progressAt, setProgressAt] = useState(row.progress_at);
  const [materializedAt, setMaterializedAt] = useState(row.materialized_at);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ email: string; last_error: string | null }[]>([]);
  const [showFailures, setShowFailures] = useState(false);
  const stop = useRef(false);
  // "Is this stalled?" depends on the clock, and this component is rendered on
  // the server as well as in the browser. Calling Date.now() during render
  // would make those two disagree near the staleness boundary and produce a
  // hydration mismatch — so the first render uses the SERVER's clock, and the
  // browser takes over afterwards.
  const [nowMs, setNowMs] = useState(serverNow);

  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => { stop.current = true; clearInterval(t); };
  }, []);

  const status = deriveBroadcastStatus({
    state, materialized_at: materializedAt, progress_at: progressAt,
    scheduled_for: row.scheduled_for, total: live.total,
    sent: live.sent, failed: live.failed, pending: live.pending, nowMs,
  });

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/admin/broadcasts/${row.id}`);
    if (!r.ok) return null;
    const j = await r.json();
    setLive({ sent: j.sent, failed: j.failed, pending: j.pending, total: j.total });
    setFailures(j.failures ?? []);
    return j;
  }, [row.id]);

  /** Drive slices until it's finished. The browser is the loop, because a
   *  serverless function can't keep working after it has replied. */
  async function pump() {
    setBusy(true); setNote(null); stop.current = false;
    try {
      for (let i = 0; i < 200 && !stop.current; i++) {
        const r = await fetch(`/api/admin/broadcasts/${row.id}`, { method: "POST" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setNote(j.error || `Stopped (${r.status})`); break; }
        setLive({ sent: j.sent, failed: j.failed, pending: j.pending, total: j.total });
        setState(j.done ? "sent" : "sending");
        setProgressAt(new Date().toISOString());
        setMaterializedAt((m) => m ?? new Date().toISOString());
        if (j.aborted === "provider_auth") {
          setNote("Stopped: the email service rejected our credentials. Nobody was marked undeliverable - fix the key and press Resume.");
          break;
        }
        if (j.skipped === "locked") { setNote("Someone else is sending this right now."); break; }
        if (j.done) break;
      }
      await refresh();
      router.refresh();
    } catch (e: any) {
      setNote(e?.message || "Stopped — press Resume to carry on.");
    } finally {
      setBusy(false);
    }
  }

  async function retryFailed() {
    setBusy(true); setNote(null);
    try {
      const r = await fetch(`/api/admin/broadcasts/${row.id}?action=retry_failed`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setNote(j.error || "Couldn't retry."); return; }
      if (j.note) setNote(j.note);
      setLive({ sent: j.sent ?? live.sent, failed: j.failed ?? live.failed, pending: j.pending ?? live.pending, total: j.total ?? live.total });
      await refresh();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const tone = TONE[status.tone];
  const denom = live.total ?? null;

  return (
    <>
      <tr>
        <td style={{ whiteSpace: "nowrap" }}>{row.created_label}</td>
        <td>{row.sent_by_email ?? "—"}</td>
        <td>{row.subject}</td>
        <td className="ra-tiny">{row.audience}</td>
        <td>
          <span style={{
            display: "inline-block", padding: "0.15rem 0.5rem", borderRadius: 999,
            background: tone.bg, color: tone.fg, fontSize: "0.72rem", fontWeight: 600, whiteSpace: "nowrap",
          }}>
            {busy ? "Sending…" : status.label}
          </span>
        </td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {denom == null ? live.sent : `${live.sent} / ${denom}`}
        </td>
        <td style={{ textAlign: "right" }}>
          {live.failed > 0 ? (
            <button onClick={() => setShowFailures((v) => !v)}
                    style={{ background: "none", border: "none", padding: 0, color: "#a5281c", cursor: "pointer", textDecoration: "underline dotted", fontSize: "inherit" }}>
              {live.failed}
            </button>
          ) : live.failed}
        </td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {status.canResume && (
            <button onClick={pump} disabled={busy} className="ra-btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem" }}>
              {busy ? "Working…" : "Resume"}
            </button>
          )}
          {status.canRetryFailed && !status.canResume && (
            <button onClick={retryFailed} disabled={busy} className="ra-btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.6rem" }}>
              Retry failed
            </button>
          )}
        </td>
      </tr>

      {(note || (showFailures && failures.length > 0) || status.isLegacy) && (
        <tr>
          <td colSpan={8} style={{ paddingTop: 0 }}>
            {status.isLegacy && (
              <div className="ra-tiny ra-quiet" style={{ marginBottom: "0.35rem" }}>
                Sent before per-recipient tracking existed, so there is no record of who received it —
                it can&rsquo;t be resumed. Sending it again would email everyone a second time.
              </div>
            )}
            {note && <div className="ra-tiny" style={{ color: "#a5561c" }}>{note}</div>}
            {showFailures && failures.length > 0 && (
              <ul className="ra-tiny" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", color: "#666" }}>
                {failures.map((f) => (
                  <li key={f.email}><code>{f.email}</code> — {f.last_error || "no reason recorded"}</li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function BroadcastForm({ counts }: { counts: { active: number; all: number } }) {
  const router = useRouter();
  const [audience, setAudience] = useState<"active_recipients" | "all_recipients" | "admins">("active_recipients");
  const [subject, setSubject]   = useState("");
  const [body, setBody]         = useState("");
  const [confirm, setConfirm]   = useState(false);
  const [schedule, setSchedule] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const targetCount = audience === "all_recipients" ? counts.all : audience === "active_recipients" ? counts.active : 0;

  /** Drive further slices from the browser. A serverless function can't keep
   *  working after it has replied, so the tab is the loop. Closing it just
   *  pauses the send — Resume in Recent broadcasts picks it back up. */
  async function pump(broadcastId: string) {
    for (let i = 0; i < 200; i++) {
      try {
        const r = await fetch(`/api/admin/broadcasts/${broadcastId}`, { method: "POST" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setMsg({ kind: "err", text: j.error || `Paused (${r.status}). Use Resume below.` }); break; }
        if (j.done) {
          setMsg({ kind: "ok", text: `Sent to ${j.sent} ${j.sent === 1 ? "family" : "families"}${j.failed ? ` (${j.failed} failed)` : ""}.` });
          break;
        }
        setMsg({ kind: "ok", text: `Sending — ${j.sent} of ${j.total ?? "?"} so far.` });
        if (j.skipped === "locked") break;
      } catch {
        setMsg({ kind: "err", text: "Paused — use Resume in Recent broadcasts to finish." });
        break;
      }
    }
    router.refresh();
  }

  async function send() {
    if (!subject.trim() || !body.trim()) { setMsg({ kind: "err", text: "Subject and body required" }); return; }
    if (schedule && !scheduledFor) { setMsg({ kind: "err", text: "Pick a send date/time" }); return; }
    setBusy(true); setMsg(null);
    try {
      const payload: any = { subject, body, audience };
      if (schedule && scheduledFor) {
        // datetime-local input lacks timezone — interpret as user's local zone
        payload.scheduled_for = new Date(scheduledFor).toISOString();
      }
      const r = await fetch("/api/admin/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);

      if (j.queued) {
        setMsg({ kind: "ok", text: `Scheduled for ${new Date(j.scheduled_for).toLocaleString()}. Sends at the next daily dispatch after that.` });
      } else if (j.done) {
        setMsg({ kind: "ok", text: `Sent to ${j.sent} ${j.sent === 1 ? "family" : "families"}${j.failed ? ` (${j.failed} failed — see Recent broadcasts)` : ""}.` });
      } else {
        // A large audience doesn't finish in one request. The browser keeps
        // going below; the row in Recent broadcasts shows live progress and a
        // Resume button if this tab is closed.
        setMsg({ kind: "ok", text: `Sending — ${j.sent} of ${j.total ?? "?"} so far. Keep this tab open, or use Resume in Recent broadcasts.` });
        pump(j.broadcast_id);
      }
      if (j.degraded === "ledger_missing") {
        setMsg({ kind: "err", text: "Sent the old way — this send can't be resumed if it's interrupted. The 20260617b database update hasn't been applied yet." });
      }

      setSubject(""); setBody(""); setConfirm(false); setSchedule(false); setScheduledFor("");
      router.refresh();
    } catch (e: any) {
      // Deliberately do NOT clear the form here, and say plainly that we don't
      // know. Clearing on an ambiguous outcome is what made operators press
      // Send again — which used to create a second broadcast and re-mail
      // everyone who had already received the first.
      setMsg({
        kind: "err",
        text: `${e?.message || "Send failed"} — we're not sure whether that finished. Check Recent broadcasts below before sending again.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ra-card">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <label className="ra-label">Audience</label>
          <select className="ra-input" value={audience} onChange={(e) => { setAudience(e.target.value as any); setConfirm(false); }}>
            <option value="active_recipients">Active recipients ({counts.active})</option>
            <option value="all_recipients">All recipients ({counts.all})</option>
            <option value="admins">Admins (small test send)</option>
          </select>
        </div>
        <div>
          <label className="ra-label">Subject</label>
          <input className="ra-input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} />
        </div>
      </div>

      <label className="ra-label">Body (HTML allowed)</label>
      <textarea className="ra-input ra-textarea" rows={10} value={body} onChange={(e) => setBody(e.target.value)}
        maxLength={20000}
        placeholder="<p>Dear family,</p><p>...</p>"
        style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.88rem" }} />
      <div className="ra-tiny" style={{ marginTop: "0.3rem" }}>
        <code>{"{{parent_names}}"}</code> personalizes the greeting per family.
      </div>

      <div className="ra-card" style={{ background: "var(--ra-bg)", marginTop: "1rem" }}>
        <div className="ra-tiny" style={{ marginBottom: "0.5rem" }}>Preview</div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: 8, border: "1px solid var(--ra-line)" }}>
          <div style={{ fontWeight: 500, marginBottom: "0.5rem" }}>{subject || "(subject)"}</div>
          <div dangerouslySetInnerHTML={{ __html: body || "<p style='color:#999'>(empty)</p>" }} />
        </div>
      </div>

      {msg && <div className={msg.kind === "ok" ? "ra-alert-success" : "ra-alert-error"} style={{ marginTop: "1rem" }}>{msg.text}</div>}

      {/* Schedule (optional) */}
      <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", border: "1px dashed var(--ra-line)", borderRadius: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.9rem" }}>
          <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} />
          Schedule for later (otherwise send immediately)
        </label>
        {schedule && (
          <div style={{ marginTop: "0.5rem" }}>
            <label className="ra-label">Send date / time</label>
            <input type="datetime-local" className="ra-input"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              min={new Date(Date.now() + 5*60*1000).toISOString().slice(0, 16)}
            />
            <div className="ra-tiny" style={{ marginTop: "0.3rem" }}>
              Broadcasts go out at the next daily cron tick (12:00 UTC) on/after this time. Set early in the morning to fire that same day.
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.9rem" }}>
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I'm sending this to <strong>{targetCount}</strong> {audience.replace("_", " ")}
        </label>
        <div style={{ flex: 1 }} />
        <button className="ra-btn" disabled={busy || !subject.trim() || !body.trim()} onClick={async () => {
          setBusy(true); setMsg(null);
          try {
            const r = await fetch("/api/admin/broadcasts/test-send", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ subject, body }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
            setMsg({ kind: "ok", text: `Test sent to ${j.sent_to}` });
          } catch (e: any) {
            setMsg({ kind: "err", text: e?.message || "Test send failed" });
          } finally { setBusy(false); }
        }}>
          Test send to me
        </button>
        <button className="ra-btn ra-btn-primary" disabled={busy || !confirm || !subject.trim() || !body.trim()} onClick={send}>
          {busy ? "Sending…" : schedule ? "Schedule" : `Send to ${targetCount}`}
        </button>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function BroadcastForm({ counts }: { counts: { active: number; all: number } }) {
  const router = useRouter();
  const [audience, setAudience] = useState<"active_recipients" | "all_recipients" | "admins">("active_recipients");
  const [subject, setSubject]   = useState("");
  const [body, setBody]         = useState("");
  const [confirm, setConfirm]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const targetCount = audience === "all_recipients" ? counts.all : audience === "active_recipients" ? counts.active : 0;

  async function send() {
    if (!subject.trim() || !body.trim()) { setMsg({ kind: "err", text: "Subject and body required" }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body, audience }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setMsg({ kind: "ok", text: `Sent to ${j.sent} recipients (${j.failed} failed).` });
      setSubject(""); setBody(""); setConfirm(false);
      router.refresh();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Send failed" });
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

      <div style={{ marginTop: "1.25rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.9rem" }}>
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I'm sending this to <strong>{targetCount}</strong> {audience.replace("_", " ")}
        </label>
        <div style={{ flex: 1 }} />
        <button className="ra-btn ra-btn-primary" disabled={busy || !confirm || !subject.trim() || !body.trim()} onClick={send}>
          {busy ? "Sending…" : `Send to ${targetCount}`}
        </button>
      </div>
    </div>
  );
}

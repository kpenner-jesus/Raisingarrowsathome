"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Tpl {
  key: string;
  label: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  vars: string[];
  updated_at: string;
}

export function TemplateEditor({ templates }: { templates: Tpl[] }) {
  const router = useRouter();
  const [active, setActive] = useState<string>(templates[0]?.key ?? "");
  const [drafts, setDrafts] = useState<Record<string, Partial<Tpl>>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const cur = templates.find((t) => t.key === active) ?? templates[0];
  if (!cur) return <div className="ra-quiet">No templates defined.</div>;
  const curKey: string = cur.key;

  const d = drafts[curKey] ?? {};
  function set(field: keyof Tpl, value: string) {
    setDrafts((curr) => ({ ...curr, [curKey]: { ...curr[curKey], [field]: value } }));
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/email-templates/${encodeURIComponent(curKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject:   d.subject   ?? cur.subject,
          body_html: d.body_html ?? cur.body_html,
          body_text: d.body_text ?? cur.body_text,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setMsg({ kind: "ok", text: "Saved." });
      setDrafts((curr) => { const next = { ...curr }; delete next[curKey]; return next; });
      router.refresh();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  const subject = d.subject   ?? cur.subject;
  const html    = d.body_html ?? cur.body_html;
  const text    = d.body_text ?? cur.body_text ?? "";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "1.25rem" }}>
      <aside style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
        {templates.map((t) => {
          const isActive = t.key === active;
          const isDirty = !!drafts[t.key];
          return (
            <button key={t.key} onClick={() => setActive(t.key)}
              className={isActive ? "ra-tab ra-tab-active" : "ra-tab"}
              style={{ textAlign: "left", borderRadius: 8 }}>
              {t.label} {isDirty && <span style={{ color: "var(--ra-accent)" }}>•</span>}
            </button>
          );
        })}
      </aside>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>
        <div className="ra-card">
          <div className="ra-tiny" style={{ marginBottom: "0.4rem" }}>
            Variables: {cur.vars.map((v) => <code key={v} style={{ marginRight: 6 }}>{`{{${v}}}`}</code>)}
          </div>

          <label className="ra-label">Subject</label>
          <input className="ra-input" value={subject} onChange={(e) => set("subject", e.target.value)} />

          <label className="ra-label" style={{ marginTop: "1rem" }}>HTML body</label>
          <textarea className="ra-input ra-textarea" rows={10} value={html}
            onChange={(e) => set("body_html", e.target.value)}
            style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }} />

          <label className="ra-label" style={{ marginTop: "1rem" }}>Plain-text fallback (optional)</label>
          <textarea className="ra-input ra-textarea" rows={5} value={text}
            onChange={(e) => set("body_text", e.target.value)}
            style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }} />
        </div>

        <div className="ra-card">
          <div className="ra-tiny" style={{ marginBottom: "0.5rem" }}>Preview (variables shown literal)</div>
          <div style={{ background: "#fff", padding: "1rem", borderRadius: 8, border: "1px solid var(--ra-line)" }}>
            <div style={{ fontWeight: 500, marginBottom: "0.5rem" }}>{subject}</div>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>

        {msg && <div className={msg.kind === "ok" ? "ra-alert-success" : "ra-alert-error"}>{msg.text}</div>}

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="ra-btn ra-btn-primary" disabled={busy || !drafts[curKey]} onClick={save}>
            {busy ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </div>
  );
}

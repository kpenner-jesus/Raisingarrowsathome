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
  const isDirty = !!drafts[curKey];
  const dirtyCount = Object.keys(drafts).length;

  return (
    <div className="ra-tpl-editor">
      {/* ─── Mobile template picker (dropdown) ─── */}
      <div className="ra-only-mobile" style={{ marginBottom: "1rem" }}>
        <label className="ra-label">Which email?</label>
        <select
          className="ra-input"
          value={active}
          onChange={(e) => setActive(e.target.value)}
          style={{ width: "100%" }}
        >
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}{drafts[t.key] ? " •" : ""}
            </option>
          ))}
        </select>
        {dirtyCount > 0 && (
          <div className="ra-tiny" style={{ marginTop: "0.4rem", color: "var(--ra-accent, #e8793a)" }}>
            {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"} across templates
          </div>
        )}
      </div>

      {/* ─── Desktop two-column layout ─── */}
      <div className="ra-tpl-cols">
        {/* Sidebar — desktop button list */}
        <aside className="ra-only-desktop ra-tpl-sidebar">
          {templates.map((t) => {
            const isActive = t.key === active;
            const isDirtyTab = !!drafts[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setActive(t.key)}
                className={isActive ? "ra-tab ra-tab-active" : "ra-tab"}
                style={{ textAlign: "left", borderRadius: 8 }}
              >
                {t.label} {isDirtyTab && <span style={{ color: "var(--ra-accent)" }}>•</span>}
              </button>
            );
          })}
        </aside>

        {/* Editor + preview */}
        <div className="ra-tpl-main">
          <div className="ra-card">
            <div className="ra-tiny" style={{ marginBottom: "0.4rem" }}>
              <strong>Variables:</strong>{" "}
              {cur.vars.length === 0
                ? <span className="ra-quiet">none</span>
                : cur.vars.map((v) => <code key={v} style={{ marginRight: 6 }}>{`{{${v}}}`}</code>)
              }
            </div>

            <label className="ra-label">Subject line</label>
            <input className="ra-input" value={subject} onChange={(e) => set("subject", e.target.value)} />

            <label className="ra-label" style={{ marginTop: "1rem" }}>Email body (HTML)</label>
            <textarea
              className="ra-input ra-textarea ra-tpl-textarea"
              rows={10}
              value={html}
              onChange={(e) => set("body_html", e.target.value)}
            />

            {/* Plain-text fallback collapsed by default on mobile to save scroll */}
            <details className="ra-tpl-plaintext" style={{ marginTop: "1rem" }}>
              <summary className="ra-label" style={{ cursor: "pointer", listStyle: "none" }}>
                Plain-text fallback (optional) <span className="ra-quiet" style={{ fontWeight: 400 }}>· tap to {text ? "edit" : "add"}</span>
              </summary>
              <textarea
                className="ra-input ra-textarea ra-tpl-textarea"
                rows={5}
                value={text}
                onChange={(e) => set("body_text", e.target.value)}
                style={{ marginTop: "0.5rem" }}
              />
            </details>
          </div>

          {/* Preview — always open on desktop, accordion on mobile */}
          <details className="ra-tpl-preview" open>
            <summary style={{ cursor: "pointer", listStyle: "none", padding: "0.6rem 0.8rem", background: "var(--ra-bg-soft, #faf6ef)", borderRadius: 10, fontWeight: 600, fontSize: "0.9rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Preview</span>
              <span className="ra-quiet" style={{ fontWeight: 400, fontSize: "0.78rem" }}>(variables shown literal)</span>
            </summary>
            <div className="ra-card" style={{ marginTop: "0.5rem" }}>
              <div style={{ background: "#fff", padding: "1rem", borderRadius: 8, border: "1px solid var(--ra-line)" }}>
                <div style={{ fontWeight: 500, marginBottom: "0.5rem" }}>{subject}</div>
                <div dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            </div>
          </details>

          {msg && <div className={msg.kind === "ok" ? "ra-alert-success" : "ra-alert-error"}>{msg.text}</div>}

          {/* Desktop save row */}
          <div className="ra-only-desktop" style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button className="ra-btn ra-btn-primary" disabled={busy || !isDirty} onClick={save}>
              {busy ? "Saving…" : "Save template"}
            </button>
          </div>
        </div>
      </div>

      {/* Sticky save bar — mobile only */}
      <div className="ra-only-mobile ra-mobile-cta" style={{ position: "fixed", bottom: 64 /* sit above tabbar */, left: 0, right: 0, zIndex: 35 }}>
        <button
          className="ra-btn ra-btn-primary"
          disabled={busy || !isDirty}
          onClick={save}
          style={{ width: "100%", opacity: isDirty ? 1 : 0.6 }}
        >
          {busy ? "Saving…" : isDirty ? `Save "${cur.label}"` : "No changes"}
        </button>
      </div>
    </div>
  );
}

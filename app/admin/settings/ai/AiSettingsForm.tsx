"use client";
// Owner-only form: choose the OpenRouter model + paste an OpenRouter API key.
// The key is write-only (never sent back from the server). When both a key and
// a model are set, the assistant runs on OpenRouter (tenant pays); otherwise it
// uses the platform Anthropic model (Sonnet 4.6), which is also the failover.

import { useState } from "react";
import { useRouter } from "next/navigation";

// Curated suggestions. The admin chat uses tool-calling + image input, so the
// chosen model must support BOTH. Pick any model from openrouter.ai/models via "Custom".
const CURATED = [
  { value: "",                            label: "Platform default — Claude Sonnet 4.6 (no OpenRouter)" },
  { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6 — Anthropic (tools + vision)" },
  { value: "openai/gpt-4o",               label: "GPT-4o — OpenAI (tools + vision)" },
  { value: "google/gemini-2.5-pro",       label: "Gemini 2.5 Pro — Google (tools + vision)" },
  { value: "__custom__",                  label: "Custom model slug…" },
];

export function AiSettingsForm({
  orgId, initialModel, keyIsSet, storageReady,
}: {
  orgId: string;
  initialModel: string;
  keyIsSet: boolean;
  storageReady: boolean;
}) {
  const router = useRouter();
  const curatedMatch = CURATED.some((c) => c.value === initialModel && c.value !== "__custom__");
  const [modelChoice, setModelChoice] = useState(
    initialModel === "" ? "" : curatedMatch ? initialModel : "__custom__",
  );
  const [customModel, setCustomModel] = useState(curatedMatch ? "" : initialModel);
  const [keyInput, setKeyInput] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const effectiveModel = (modelChoice === "__custom__" ? customModel : modelChoice).trim();

  function dirtyClear() { setError(null); setSaved(false); }

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      const body: Record<string, unknown> = { orgId, model: effectiveModel || null };
      if (removeKey)            body.openrouter_key = null;
      else if (keyInput.trim()) body.openrouter_key = keyInput.trim();
      const r = await fetch("/api/admin/ai-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setSaved(true);
      setKeyInput(""); setRemoveKey(false);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!storageReady && (
        <div className="ra-alert-error" style={{ marginBottom: "1rem" }}>
          Key storage isn&rsquo;t configured on this deployment (<code>AI_KEY_ENCRYPTION_SECRET</code> is unset),
          so you can&rsquo;t save an OpenRouter key yet. The assistant keeps running on the platform model until it&rsquo;s set.
        </div>
      )}

      <section className="ra-card" style={{ marginBottom: "1.25rem" }}>
        <h2 className="ra-section-title">Model</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "0.85rem", lineHeight: 1.5 }}>
          Which model the assistant runs on. The admin chat uses tool-calling + image input (receipt photos),
          so the model must support <strong>both</strong>. Browse all options at{" "}
          <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer" style={{ color: "var(--ra-accent)" }}>openrouter.ai/models</a>.
        </p>
        <select
          value={modelChoice}
          onChange={(e) => { setModelChoice(e.target.value); dirtyClear(); }}
          className="ra-input"
          style={{ width: "100%", marginBottom: modelChoice === "__custom__" ? "0.75rem" : 0 }}
        >
          {CURATED.map((c) => <option key={c.value || "default"} value={c.value}>{c.label}</option>)}
        </select>
        {modelChoice === "__custom__" && (
          <input
            type="text"
            value={customModel}
            onChange={(e) => { setCustomModel(e.target.value); dirtyClear(); }}
            placeholder="provider/model-slug  (e.g. anthropic/claude-sonnet-4.6)"
            className="ra-input"
            style={{ width: "100%", fontFamily: "ui-monospace, monospace" }}
          />
        )}
        {effectiveModel === "" && (
          <p className="ra-quiet" style={{ fontSize: "0.82rem", marginTop: "0.6rem" }}>
            With no model selected, the assistant uses the platform default (Claude Sonnet 4.6) at no cost to you.
          </p>
        )}
      </section>

      <section className="ra-card" style={{ marginBottom: "1.25rem" }}>
        <h2 className="ra-section-title">OpenRouter API key</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "0.85rem", lineHeight: 1.5 }}>
          Get a key at{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{ color: "var(--ra-accent)" }}>openrouter.ai/keys</a>.
          It&rsquo;s stored encrypted and used only to run your assistant — usage bills to <strong>your</strong> OpenRouter account.
          A model must also be selected above for it to take effect.
        </p>

        {keyIsSet && !removeKey ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
            <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--text-secondary)" }}>•••••••• key saved</span>
            <button type="button" onClick={() => { setRemoveKey(true); dirtyClear(); }} className="ra-btn" style={{ fontSize: "0.85rem" }}>
              Remove key
            </button>
          </div>
        ) : removeKey ? (
          <div className="ra-quiet" style={{ marginBottom: "0.6rem" }}>
            Key will be removed on save — the assistant reverts to the platform model.{" "}
            <button type="button" onClick={() => { setRemoveKey(false); dirtyClear(); }} style={{ background: "none", border: "none", color: "var(--ra-accent)", cursor: "pointer", padding: 0 }}>undo</button>
          </div>
        ) : null}

        {!removeKey && (
          <input
            type="password"
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); dirtyClear(); }}
            placeholder={keyIsSet ? "Paste a new key to replace the saved one" : "sk-or-v1-…"}
            autoComplete="off"
            disabled={!storageReady}
            className="ra-input"
            style={{ width: "100%", fontFamily: "ui-monospace, monospace" }}
          />
        )}
      </section>

      {error && <div className="ra-alert-error" style={{ marginBottom: "0.85rem" }}>{error}</div>}
      {saved && <div className="ra-alert-success" style={{ marginBottom: "0.85rem" }}>Saved.</div>}

      <button onClick={save} disabled={busy} className="ra-btn ra-btn-primary" style={{ minHeight: 52 }}>
        {busy ? "Saving…" : "Save AI settings"}
      </button>
    </>
  );
}

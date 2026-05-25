"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../_components/Toaster";
import { ConfirmModal } from "../_components/ConfirmModal";

interface Token {
  id: string;
  label: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

export default function TokenManager({ initialTokens }: { initialTokens: Token[] }) {
  const router = useRouter();
  const { notify } = useToast();
  const [tokens, setTokens] = useState(initialTokens);
  const [label, setLabel]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [revealed, setRevealed] = useState<{ plaintext: string; label: string } | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const mint = async () => {
    if (!label.trim()) { notify("Please name this token (e.g. 'iPhone Claude')", "error"); return; }
    setBusy(true);
    const res = await fetch("/api/admin/mcp/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim() }),
    });
    setBusy(false);
    if (!res.ok) { notify(`Failed: ${await res.text()}`, "error"); return; }
    const t = await res.json();
    setRevealed({ plaintext: t.token, label: t.label });
    setLabel("");
    setTokens([{ ...t, last_used_at: null, revoked_at: null, expires_at: null }, ...tokens]);
    router.refresh();
  };

  const revoke = async () => {
    if (!revokeId) return;
    setBusy(true);
    const res = await fetch(`/api/admin/mcp/tokens/${revokeId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) { notify(`Failed: ${await res.text()}`, "error"); setRevokeId(null); return; }
    setTokens((curr) => curr.map((t) => t.id === revokeId ? { ...t, revoked_at: new Date().toISOString() } : t));
    setRevokeId(null);
    notify("Token revoked");
    router.refresh();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard");
    } catch {
      notify("Copy failed — please select and copy manually", "error");
    }
  };

  const tokenToRevoke = tokens.find((t) => t.id === revokeId);

  return (
    <>
      <section className="ra-card" style={{ marginBottom: "1.5rem" }}>
        <h3 className="ra-section-title">Your tokens</h3>

        <div className="ra-row" style={{ alignItems: "flex-end", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <label className="ra-label">Token name</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. 'Kevin laptop Claude Code'"
              className="ra-input" maxLength={60}
              onKeyDown={(e) => { if (e.key === "Enter") mint(); }}
            />
          </div>
          <button onClick={mint} disabled={busy || !label.trim()} className="ra-btn ra-btn-accent">
            {busy ? "Minting…" : "+ Mint token"}
          </button>
        </div>

        {tokens.length === 0 ? (
          <div className="ra-empty">
            <div className="ra-empty-icon">⚿</div>
            <div className="ra-empty-title">No tokens yet</div>
            <div>Name one above and click <strong>Mint token</strong>.</div>
          </div>
        ) : (
          <table className="ra-table ra-table-mobile">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.label}</strong></td>
                  <td className="ra-tiny" style={{ fontFamily: "ui-monospace, monospace" }}>{t.prefix}…</td>
                  <td className="ra-tiny">{new Date(t.created_at).toLocaleDateString("en-CA")}</td>
                  <td className="ra-tiny">
                    {t.last_used_at
                      ? new Date(t.last_used_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })
                      : <span className="ra-quiet">never</span>}
                  </td>
                  <td>
                    {t.revoked_at
                      ? <span className="ra-badge ra-badge-rejected">revoked</span>
                      : <span className="ra-badge ra-badge-active">active</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!t.revoked_at && (
                      <button onClick={() => setRevokeId(t.id)} className="ra-btn ra-btn-danger ra-btn-sm">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Revealed-once modal */}
      {revealed && (
        <div className="ra-modal-backdrop" onClick={() => setRevealed(null)}>
          <div className="ra-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="ra-h2" style={{ marginBottom: "0.5rem" }}>
              Token: <em>{revealed.label}</em>
            </h2>
            <div className="ra-alert ra-alert-warn" style={{ marginBottom: "1rem" }}>
              <span className="ra-badge-dot" />
              <span><strong>Save this NOW.</strong> We will never show it again. The next time you visit this page only the prefix is visible.</span>
            </div>

            <pre style={{
              background: "var(--ra-ink)", color: "#fff",
              padding: "0.85rem 1rem", borderRadius: 8, fontSize: "0.85rem",
              fontFamily: "ui-monospace, monospace", overflowX: "auto",
              wordBreak: "break-all", whiteSpace: "pre-wrap",
            }}>
              {revealed.plaintext}
            </pre>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem" }}>
              <button onClick={() => copy(revealed.plaintext)} className="ra-btn ra-btn-ghost">
                Copy token
              </button>
              <button onClick={() => copy(`claude mcp add raising-arrows --scope user --transport http --header 'Authorization: Bearer ${revealed.plaintext}' https://raisingarrowsathome.com/api/mcp`)} className="ra-btn ra-btn-accent">
                Copy Claude Code one-liner
              </button>
            </div>

            <div style={{ marginTop: "1rem", textAlign: "right" }}>
              <button onClick={() => setRevealed(null)} className="ra-btn ra-btn-primary">
                I've saved it
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={revokeId !== null}
        title={`Revoke "${tokenToRevoke?.label || ""}"?`}
        body="The AI agent using this token will lose access immediately. Cannot be undone — you'll need to mint a fresh token to reconnect."
        confirmLabel="Revoke"
        destructive
        busy={busy}
        onConfirm={revoke}
        onCancel={() => setRevokeId(null)}
      />
    </>
  );
}

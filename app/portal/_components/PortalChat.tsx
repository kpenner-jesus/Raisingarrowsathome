"use client";
// PortalChat — read-only help bubble for grant families. Posts to
// /api/portal/chat which answers only from this family's own grant data.
// No tools, no confirm — just friendly Q&A.

import { useEffect, useRef, useState } from "react";

type Block = { type: string; text?: string };
type Msg = { role: "user" | "assistant"; content: string | Block[] };

function textOf(m: Msg): string {
  if (typeof m.content === "string") return m.content;
  return m.content.filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
}

export function PortalChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next); setInput(""); setBusy(true); setError(null);
    try {
      const r = await fetch("/api/portal/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMessages(j.messages || next);
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Open help"
          style={{ position: "fixed", right: 18, bottom: 84, zIndex: 55, width: 52, height: 52, borderRadius: "50%", border: "none", cursor: "pointer", background: "linear-gradient(180deg, var(--accent, #e8793a), #c45f20)", color: "#fff", fontSize: 22, boxShadow: "0 6px 20px rgba(232,121,58,0.4)" }}>
          ?
        </button>
      )}
      {open && (
        <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(400px, 100vw)", zIndex: 55, background: "#fff", borderLeft: "1px solid rgba(0,0,0,0.1)", boxShadow: "-8px 0 24px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column" }}>
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1rem", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
            <div style={{ fontWeight: 600 }}>Grant help</div>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#666" }}>✕</button>
          </header>
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
            {messages.length === 0 && (
              <div style={{ color: "#888", fontSize: "0.9rem", lineHeight: 1.6 }}>
                Hi! Ask me about your grant — your balance, whether a receipt was approved,
                your remaining amount, or how to upload a receipt.
              </div>
            )}
            {messages.map((m, i) => {
              const t = textOf(m);
              if (!t) return null;
              const isUser = m.role === "user";
              return (
                <div key={i} style={{
                  alignSelf: isUser ? "flex-end" : "flex-start", maxWidth: "85%",
                  background: isUser ? "var(--accent, #e8793a)" : "rgba(0,0,0,0.05)",
                  color: isUser ? "#fff" : "#1a1a1a", padding: "0.6rem 0.85rem", borderRadius: 12,
                  fontSize: "0.92rem", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>{t}</div>
              );
            })}
            {busy && <div style={{ color: "#999", fontSize: "0.85rem" }}>Thinking…</div>}
            {error && <div style={{ color: "#a83232", fontSize: "0.85rem", background: "rgba(224,80,80,0.08)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</div>}
          </div>
          <div style={{ padding: "0.75rem", borderTop: "1px solid rgba(0,0,0,0.08)", display: "flex", gap: "0.5rem" }}>
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
              placeholder="Ask about your grant…" disabled={busy}
              style={{ flex: 1, padding: "0.7rem 0.9rem", borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)", fontSize: 15 }} />
            <button onClick={send} disabled={busy || !input.trim()}
              style={{ background: "linear-gradient(180deg, var(--accent, #e8793a), #c45f20)", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem 1rem", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}

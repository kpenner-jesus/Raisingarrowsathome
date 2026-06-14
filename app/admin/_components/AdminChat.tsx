"use client";
// AdminChat — the in-app operator assistant. A floating button opens a
// right-side drawer. The client holds the raw Anthropic message array and
// replays it each turn; the server runs the tool loop and halts on mutating
// tools so the admin can Confirm. Read-only lookups run automatically.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Block = { type: string; text?: string; name?: string; input?: any; id?: string };
type Msg = { role: "user" | "assistant"; content: string | Block[] };
type Pending = { tool_use_id: string; name: string; input: any };

function blocksOf(m: Msg): Block[] {
  if (typeof m.content === "string") return [{ type: "text", text: m.content }];
  return m.content;
}
function textOf(m: Msg): string {
  return blocksOf(m).filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
}
function toolNames(m: Msg): string[] {
  return blocksOf(m).filter((b) => b.type === "tool_use").map((b) => b.name || "").filter(Boolean);
}

const PRETTY: Record<string, string> = {
  decide_application: "Approve / deny an application",
  decide_receipt: "Approve / reject a receipt",
  modify_recipient: "Modify a recipient",
  generate_payout_batch: "Generate a payout batch",
  mark_batch_paid: "Mark a payout batch paid",
  export_batch_csv: "Export a payout batch CSV",
  bulk_create_recipients: "Bulk-import recipients",
  set_user_role: "Change a team member's role",
};

export function AdminChat() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, busy]);

  async function post(body: any) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMessages(j.messages || []);
      setPending(j.kind === "pending" ? j.pending : null);
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    post({ messages: next });
  }

  function decide(approved: boolean) {
    if (!pending || busy) return;
    const action = { name: pending.name, input: pending.input };
    setPending(null);
    post({ messages, confirm: { approved, action } });
    // After an approved mutation, refresh the page so it reflects the change.
    if (approved) setTimeout(() => router.refresh(), 1200);
  }

  function reset() {
    setMessages([]); setPending(null); setError(null); setInput("");
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          style={{
            position: "fixed", right: 20, bottom: 20, zIndex: 60,
            width: 56, height: 56, borderRadius: "50%", border: "none", cursor: "pointer",
            background: "linear-gradient(180deg, var(--ra-accent, #e8793a), #c45f20)",
            color: "#fff", fontSize: 22, boxShadow: "0 6px 20px rgba(232,121,58,0.4)",
          }}
        >✦</button>
      )}

      {open && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(420px, 100vw)", zIndex: 60,
          background: "#fff", borderLeft: "1px solid rgba(0,0,0,0.1)", boxShadow: "-8px 0 24px rgba(0,0,0,0.12)",
          display: "flex", flexDirection: "column",
        }}>
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.85rem 1rem", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
            <div style={{ fontWeight: 600 }}>✦ Assistant</div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={reset} title="New chat" style={iconBtn}>＋</button>
              <button onClick={() => setOpen(false)} title="Close" style={iconBtn}>✕</button>
            </div>
          </header>

          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {messages.length === 0 && (
              <div style={{ color: "#888", fontSize: "0.9rem", lineHeight: 1.6 }}>
                Ask me about applications, recipients, receipts, or payouts — e.g.
                <em> &ldquo;how many applications are pending?&rdquo;</em> or
                <em> &ldquo;approve the application from the Penner family for $1,200&rdquo;</em>.
                I&rsquo;ll ask you to confirm anything that changes money or grant decisions.
              </div>
            )}
            {messages.map((m, i) => {
              if (m.role === "user") {
                if (typeof m.content !== "string") return null; // tool_result plumbing
                return <Bubble key={i} who="user">{m.content}</Bubble>;
              }
              const text = textOf(m);
              const tools = toolNames(m);
              return (
                <div key={i}>
                  {tools.length > 0 && (
                    <div style={{ fontSize: "0.72rem", color: "#999", marginBottom: 4 }}>
                      • {tools.map((t) => t.replace(/_/g, " ")).join(", ")}
                    </div>
                  )}
                  {text && <Bubble who="assistant">{text}</Bubble>}
                </div>
              );
            })}

            {pending && (
              <div style={{ border: "1.5px solid var(--ra-accent, #e8793a)", borderRadius: 12, padding: "0.85rem", background: "rgba(232,121,58,0.06)" }}>
                <div style={{ fontWeight: 600, fontSize: "0.92rem", marginBottom: 4 }}>
                  Confirm: {PRETTY[pending.name] || pending.name.replace(/_/g, " ")}
                </div>
                <pre style={{ fontSize: "0.74rem", background: "rgba(0,0,0,0.04)", padding: "0.5rem", borderRadius: 6, overflowX: "auto", margin: "0.4rem 0", whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(pending.input, null, 2)}
                </pre>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button onClick={() => decide(true)} disabled={busy} style={{ ...primaryBtn, flex: 1 }}>Confirm</button>
                  <button onClick={() => decide(false)} disabled={busy} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
                </div>
              </div>
            )}

            {busy && <div style={{ color: "#999", fontSize: "0.85rem" }}>Thinking…</div>}
            {error && <div style={{ color: "#a83232", fontSize: "0.85rem", background: "rgba(224,80,80,0.08)", padding: "0.5rem 0.7rem", borderRadius: 8 }}>{error}</div>}
          </div>

          <div style={{ padding: "0.75rem", borderTop: "1px solid rgba(0,0,0,0.08)", display: "flex", gap: "0.5rem" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={pending ? "Confirm or cancel above first…" : "Ask the assistant…"}
              disabled={busy || !!pending}
              style={{ flex: 1, padding: "0.7rem 0.9rem", borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)", fontSize: 15 }}
            />
            <button onClick={send} disabled={busy || !!pending || !input.trim()} style={primaryBtn}>Send</button>
          </div>
        </div>
      )}
    </>
  );
}

function Bubble({ who, children }: { who: "user" | "assistant"; children: React.ReactNode }) {
  const isUser = who === "user";
  return (
    <div style={{
      alignSelf: isUser ? "flex-end" : "flex-start",
      maxWidth: "85%",
      background: isUser ? "var(--ra-accent, #e8793a)" : "rgba(0,0,0,0.05)",
      color: isUser ? "#fff" : "#1a1a1a",
      padding: "0.6rem 0.85rem", borderRadius: 12,
      fontSize: "0.92rem", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
    }}>{children}</div>
  );
}

const iconBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#666", width: 28, height: 28 };
const primaryBtn: React.CSSProperties = { background: "linear-gradient(180deg, var(--ra-accent, #e8793a), #c45f20)", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem 1rem", fontWeight: 600, cursor: "pointer", fontSize: 14 };
const ghostBtn: React.CSSProperties = { background: "transparent", color: "#666", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 10, padding: "0.7rem 1rem", fontWeight: 600, cursor: "pointer", fontSize: 14 };

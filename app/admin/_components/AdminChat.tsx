"use client";
// AdminChat — the in-app operator assistant. A floating button opens a
// right-side drawer. The client holds the raw Anthropic message array and
// replays it each turn; the server runs the tool loop and halts on mutating
// tools so the admin can Confirm. Read-only lookups run automatically.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sniffKind, extractFileText, fileTextBlock, type ExtractedFile } from "@/app/lib/ai/file-text";

type ImageSource = { type: string; media_type: string; data: string };
type Block = { type: string; text?: string; name?: string; input?: any; id?: string; source?: ImageSource };
type Msg = { role: "user" | "assistant"; content: string | Block[] };
type Pending = { tool_use_id: string; name: string; input: any };
type Attachment = { dataUrl: string; mediaType: string; data: string };

/** Downscale + re-encode to JPEG so payloads stay small and OCR-friendly. */
async function compressImage(file: File): Promise<Attachment> {
  const dataUrl: string = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = dataUrl;
  });
  const MAX = 1600;
  let { width, height } = img;
  if (width > MAX || height > MAX) {
    const s = Math.min(MAX / width, MAX / height);
    width = Math.round(width * s);
    height = Math.round(height * s);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const cctx = canvas.getContext("2d");
  if (!cctx) throw new Error("no canvas context");
  cctx.drawImage(img, 0, 0, width, height);
  const out = canvas.toDataURL("image/jpeg", 0.82);
  return { dataUrl: out, mediaType: "image/jpeg", data: out.split(",")[1] };
}

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
  create_receipt: "Create a receipt from a photo",
};

export function AdminChat() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<Attachment | null>(null);
  const [doc, setDoc] = useState<ExtractedFile | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachSeq = useRef(0);

  async function attachFile(file: File) {
    const myId = ++attachSeq.current;
    const kind = sniffKind(file.name, file.type);
    try {
      if (kind === "image") {
        const result = await compressImage(file);
        if (attachSeq.current !== myId) return; // a newer attach superseded this one
        setDoc(null); setImage(result); setError(null);
        return;
      }
      // Spreadsheet / CSV / text → extracted to text client-side, so the
      // converted content lives in the replayed history (see file-text.ts).
      const extracted = await extractFileText(file);
      if (attachSeq.current !== myId) return;
      setImage(null); setDoc(extracted);
      setError(extracted.truncated ? `Attached "${extracted.name}" — it was long, so only the first part is included.` : null);
    } catch (e: any) {
      if (attachSeq.current !== myId) return;
      setError(e?.message || "Couldn't read that file.");
    }
  }
  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
    if (item) { const f = item.getAsFile(); if (f) { e.preventDefault(); attachFile(f); } }
  }

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
      return j;
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if ((!text && !image && !doc) || busy) return;
    if (messages.length >= 78) { setError("This chat is getting long — click ＋ (top-right) to start a new one."); return; }
    let content: string | Block[];
    if (image) {
      const blocks: Block[] = [];
      if (text) blocks.push({ type: "text", text });
      blocks.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
      content = blocks;
    } else if (doc) {
      // Data files ride along as text so they replay cleanly on later turns.
      content = text ? `${text}\n\n${fileTextBlock(doc)}` : fileTextBlock(doc);
    } else {
      content = text;
    }
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput(""); setImage(null); setDoc(null);
    post({ messages: next });
  }

  async function decide(approved: boolean) {
    if (!pending || busy) return;
    // create_receipt needs an attached photo in the conversation; block the
    // confirm early (with a clear message) instead of letting it fail server-side.
    if (approved && pending.name === "create_receipt"
        && !messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image"))) {
      setError("Attach the receipt photo first, then ask me to enter it.");
      setPending(null);
      return;
    }
    setPending(null);
    const j = await post({ messages, confirm: { approved } });
    // Refresh only after the mutation actually settled (not on a fixed timer
    // that could race the in-flight turn or fire on a failed tool).
    if (approved && j && j.kind === "final") router.refresh();
  }

  function reset() {
    setMessages([]); setPending(null); setError(null); setInput(""); setImage(null); setDoc(null);
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
                You can also <strong>attach a spreadsheet (.xlsx), .csv or text file</strong> — e.g. your existing grantee
                list — and I&rsquo;ll read it and propose a bulk import. Or <strong>paste a receipt photo</strong> and
                I&rsquo;ll create the receipt entry for the family you name. I&rsquo;ll ask you to confirm anything that
                changes money or grant decisions.
              </div>
            )}
            {messages.map((m, i) => {
              if (m.role === "user") {
                if (typeof m.content === "string") return <Bubble key={i} who="user">{m.content}</Bubble>;
                const blocks = m.content;
                if (blocks.every((b) => b.type === "tool_result")) return null; // tool_result plumbing
                const txt  = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("");
                const imgs = blocks.filter((b) => b.type === "image" && b.source);
                return (
                  <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    {imgs.map((b, k) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={k} src={`data:${b.source!.media_type};base64,${b.source!.data}`} alt="attachment"
                           style={{ maxWidth: 200, maxHeight: 200, borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)" }} />
                    ))}
                    {txt && <Bubble who="user">{txt}</Bubble>}
                  </div>
                );
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
                {pending.name === "create_receipt" && (() => {
                  // Show the exact photo that will be stored so you verify the
                  // real evidence, not just the AI-extracted fields.
                  let src: string | null = null;
                  for (let i = messages.length - 1; i >= 0 && !src; i--) {
                    const c = messages[i].content;
                    if (!Array.isArray(c)) continue;
                    for (let j = c.length - 1; j >= 0; j--) {
                      const b = c[j];
                      if (b.type === "image" && b.source) { src = `data:${b.source.media_type};base64,${b.source.data}`; break; }
                    }
                  }
                  return src ? (
                    <div style={{ margin: "0.4rem 0" }}>
                      <div style={{ fontSize: "0.72rem", color: "#666", marginBottom: 4 }}>Photo that will be saved:</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="receipt to save" style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)" }} />
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.78rem", color: "#a83232", margin: "0.4rem 0" }}>No photo attached — Cancel and attach the receipt photo first.</div>
                  );
                })()}
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

          <div style={{ padding: "0.75rem", borderTop: "1px solid rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {image && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,0.04)", padding: "0.4rem 0.5rem", borderRadius: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.dataUrl} alt="receipt" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)" }} />
                <span style={{ fontSize: "0.82rem", color: "#666", flex: 1 }}>Receipt photo attached</span>
                <button onClick={() => setImage(null)} title="Remove" style={iconBtn}>✕</button>
              </div>
            )}
            {doc && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,0.04)", padding: "0.4rem 0.5rem", borderRadius: 10 }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>📄</span>
                <span style={{ fontSize: "0.82rem", color: "#666", flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</span>
                  {doc.text.split("\n").length.toLocaleString()} lines{doc.truncated ? " (truncated)" : ""}
                </span>
                <button onClick={() => setDoc(null)} title="Remove" style={iconBtn}>✕</button>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input ref={fileRef} type="file"
                     accept="image/*,.csv,.tsv,.txt,.md,.json,.xlsx,.xls"
                     style={{ display: "none" }}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) attachFile(f); e.target.value = ""; }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy || !!pending} title="Attach a photo, spreadsheet (.xlsx), or .csv" style={iconBtn}>📎</button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                onPaste={onPaste}
                placeholder={pending ? "Confirm or cancel above first…" : "Ask, or attach a spreadsheet or photo…"}
                disabled={busy || !!pending}
                style={{ flex: 1, padding: "0.7rem 0.9rem", borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)", fontSize: 15 }}
              />
              <button onClick={send} disabled={busy || !!pending || (!input.trim() && !image && !doc)} style={primaryBtn}>Send</button>
            </div>
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

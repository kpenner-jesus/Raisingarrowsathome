"use client";
// AdminChat — the in-app operator assistant. A floating button opens a
// right-side drawer. The client holds the raw Anthropic message array and
// replays it each turn; the server runs the tool loop and halts on mutating
// tools so the admin can Confirm. Read-only lookups run automatically.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  sniffKind, extractFileText, fileTextBlock, fileToBase64, safeName,
  MAX_PDF_B64, SUPPORTED_HINT, type ExtractedFile,
} from "@/app/lib/ai/file-text";
import { MAX_PDF_BYTES, MAX_ATTACH_BYTES, MAX_SEND_CHARS } from "@/app/lib/ai/attachments";
import { driveConfig, pickFromDrive } from "@/app/lib/ai/google-drive";

type ImageSource = { type: string; media_type: string; data: string };
type Block = { type: string; text?: string; name?: string; input?: any; id?: string; source?: ImageSource };
type Msg = { role: "user" | "assistant"; content: string | Block[] };
type Pending = { tool_use_id: string; name: string; input: any };
type Attachment = { dataUrl: string; mediaType: string; data: string };
type PdfAttachment = { name: string; data: string };

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
/** Everything the assistant DID this turn — our own tools plus Anthropic-run
 *  server tools. Web searches show their QUERY: a search leaves this system,
 *  so the admin needs to see what went out, not just that something did. */
function activityLines(m: Msg): string[] {
  return blocksOf(m)
    .filter((b) => b.type === "tool_use" || b.type === "server_tool_use")
    .map((b) => {
      const name = (b.name || "").replace(/_/g, " ");
      if (!name) return "";
      const q = b.input?.query;
      return typeof q === "string" && q ? `${name}: "${q}"` : name;
    })
    .filter(Boolean);
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
  delete_record: "PERMANENTLY DELETE a record",
  create_email_template: "Create an email template",
  update_email_template: "Change an email template",
  archive_email_template: "Archive / restore an email template",
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
  const [pdf, setPdf] = useState<PdfAttachment | null>(null);
  const [attachMenu, setAttachMenu] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  // Read once: NEXT_PUBLIC_* are build-time constants, and reading during
  // render would differ between the server and client passes.
  const [driveReady, setDriveReady] = useState(false);
  useEffect(() => { setDriveReady(driveConfig().ready); }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachSeq = useRef(0);

  /** Only one attachment rides along at a time — attaching replaces. */
  function clearAttachments() { setImage(null); setDoc(null); setPdf(null); }

  async function attachFile(file: File) {
    const myId = ++attachSeq.current;
    const kind = sniffKind(file.name, file.type);
    try {
      if (file.size > MAX_ATTACH_BYTES) {
        throw new Error(`"${file.name}" is too large to attach.`);
      }
      if (kind === "image") {
        // canvas can't decode HEIC/HEIF, so say so rather than "couldn't read".
        const result = await compressImage(file).catch(() => {
          throw new Error(`Couldn't open "${file.name}". If it's a HEIC photo from an iPhone, export it as JPG and attach that.`);
        });
        if (attachSeq.current !== myId) return; // a newer attach superseded this one
        clearAttachments(); setImage(result); setError(null);
        return;
      }
      if (kind === "pdf") {
        // Check the SIZE first: base64-ing a 300 MB file to discover it's too
        // big freezes (or kills) the tab before the message can be shown.
        if (file.size > MAX_PDF_BYTES) throw new Error("That PDF is too large — keep it under about 2 MB.");
        // Sent to the model whole — Claude reads PDFs natively, including
        // scanned receipts with no text layer, so we don't parse it here.
        const data = await fileToBase64(file);
        if (data.length > MAX_PDF_B64) throw new Error("That PDF is too large — keep it under about 2 MB.");
        if (attachSeq.current !== myId) return;
        clearAttachments(); setPdf({ name: file.name, data }); setError(null);
        return;
      }
      // Spreadsheet / CSV / text → extracted to text client-side, so the
      // converted content lives in the replayed history (see file-text.ts).
      const extracted = await extractFileText(file);
      if (attachSeq.current !== myId) return;
      clearAttachments(); setDoc(extracted);
      setError(extracted.truncated ? `Attached "${extracted.name}" — it was long, so only the first part is included.` : null);
    } catch (e: any) {
      if (attachSeq.current !== myId) return;
      setError(e?.message || `Couldn't read that file. ${SUPPORTED_HINT}`);
    }
  }
  /** Pick a file out of Google Drive, then hand it to the SAME path a local
   *  file takes — so Drive adds a source, not a second set of rules. */
  async function attachFromDrive() {
    setError(null);
    setDriveBusy(true);
    try {
      const file = await pickFromDrive();
      if (file) await attachFile(file); // null = the admin cancelled the picker
    } catch (e: any) {
      setError(e?.message || "Couldn't get that file from Google Drive.");
    } finally {
      setDriveBusy(false);
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
    if (item) { const f = item.getAsFile(); if (f) { e.preventDefault(); attachFile(f); } }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, busy]);

  // Build a blob URL for the PDF a pending create_receipt would store, so the
  // confirm card can actually show the evidence. Revoked when the card closes.
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pending || pending.name !== "create_receipt") { setPdfPreviewUrl(null); return; }
    let data: string | null = null;
    for (let i = messages.length - 1; i >= 0 && !data; i--) {
      const c = messages[i].content;
      if (!Array.isArray(c)) continue;
      for (let j = c.length - 1; j >= 0; j--) {
        const b = c[j];
        if (b.type === "document" && b.source?.data) { data = b.source.data; break; }
        if (b.type === "image") { return; } // a photo is newer — no PDF preview
      }
    }
    if (!data) { setPdfPreviewUrl(null); return; }
    let url: string;
    try {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    } catch { setPdfPreviewUrl(null); return; }
    setPdfPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pending, messages]);

  async function post(body: any) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // A platform-level rejection (413 body too large, 504) is NOT JSON —
      // parsing first turned a clear message into "Unexpected token".
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(j?.error
          || (r.status === 413 ? "That was too large to send — start a new chat (＋) and attach just the file you need."
          : `Request failed (${r.status}).`));
      }
      if (!j) throw new Error("Got an unreadable reply from the server.");
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
    if ((!text && !image && !doc && !pdf) || busy) return;
    if (messages.length >= 78) { setError("This chat is getting long — click ＋ (top-right) to start a new one."); return; }
    let content: string | Block[];
    if (image) {
      const blocks: Block[] = [];
      if (text) blocks.push({ type: "text", text });
      blocks.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
      content = blocks;
    } else if (pdf) {
      // The document block carries no filename, so name it in the text — the
      // assistant quotes it back and it reads correctly in the transcript.
      // safeName: a Drive file can be named by whoever shared it, so the name
      // is untrusted text landing in the highest-trust slot in the prompt.
      const label = `[Attached PDF: ${safeName(pdf.name)}]`;
      content = [
        { type: "text", text: text ? `${text}\n\n${label}` : label },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.data } },
      ];
    } else if (doc) {
      // Data files ride along as text so they replay cleanly on later turns.
      content = text ? `${text}\n\n${fileTextBlock(doc)}` : fileTextBlock(doc);
    } else {
      content = text;
    }
    const next: Msg[] = [...messages, { role: "user", content }];
    // Pre-flight the payload: past ~4.5 MB the hosting platform rejects the
    // request before our API sees it, and the reply isn't JSON.
    const payload = JSON.stringify({ messages: next });
    if (payload.length > MAX_SEND_CHARS) {
      setError("This chat has grown too large to send — click ＋ to start a new one.");
      return;
    }
    const prev = messages, prevImage = image, prevDoc = doc, prevPdf = pdf, prevInput = input;
    setMessages(next);
    setInput(""); clearAttachments();
    post({ messages: next }).then((ok) => {
      // A rejected turn must NOT stay in the history — it would be replayed,
      // and fail identically, on every later message.
      if (!ok) {
        setMessages(prev); setInput(prevInput);
        setImage(prevImage); setDoc(prevDoc); setPdf(prevPdf);
      }
    });
  }

  async function decide(approved: boolean) {
    if (!pending || busy) return;
    // create_receipt needs an attached photo in the conversation; block the
    // confirm early (with a clear message) instead of letting it fail server-side.
    if (approved && pending.name === "create_receipt"
        && !messages.some((m) => Array.isArray(m.content)
             && m.content.some((b) => b.type === "image" || b.type === "document"))) {
      setError("Attach the receipt photo or PDF first, then ask me to enter it.");
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
    setMessages([]); setPending(null); setError(null); setInput("");
    // clearAttachments(), not a hand-listed subset — a forgotten one here armed
    // the previous chat's PDF onto the next conversation's receipt.
    clearAttachments(); setAttachMenu(false); setDriveBusy(false);
    attachSeq.current++; // abandon any attach still in flight
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
                list — and I&rsquo;ll read it and propose a bulk import. Or <strong>attach a receipt photo or PDF</strong> and
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
              const tools = activityLines(m);
              return (
                <div key={i}>
                  {tools.length > 0 && (
                    <div style={{ fontSize: "0.72rem", color: "#999", marginBottom: 4 }}>
                      • {tools.join(" · ")}
                    </div>
                  )}
                  {text && <Bubble who="assistant">{text}</Bubble>}
                </div>
              );
            })}

            {pending && (() => {
            // A delete must not look like every other confirm. Red frame,
            // explicit "permanent", and the reason shown back to the admin.
            const destructive = pending.name === "delete_record";
            return (
              <div style={{
                border: `1.5px solid ${destructive ? "#c0392b" : "var(--ra-accent, #e8793a)"}`,
                borderRadius: 12, padding: "0.85rem",
                background: destructive ? "rgba(192,57,43,0.07)" : "rgba(232,121,58,0.06)",
              }}>
                <div style={{ fontWeight: 600, fontSize: "0.92rem", marginBottom: 4, color: destructive ? "#a5281c" : undefined }}>
                  {destructive ? "⚠ " : ""}Confirm: {PRETTY[pending.name] || pending.name.replace(/_/g, " ")}
                </div>
                {destructive && (
                  <div style={{ fontSize: "0.8rem", color: "#a5281c", marginBottom: 6, lineHeight: 1.45 }}>
                    This permanently removes the record below. A copy is kept in the audit log,
                    but nothing in the app puts it back — restoring it means going into the database by hand.
                    {pending.input?.cascade
                      ? <><br /><strong>Related records will be deleted with it.</strong></>
                      : null}
                    {pending.input?.reason
                      ? <><br />Reason recorded: “{String(pending.input.reason).slice(0, 200)}”</>
                      : null}
                  </div>
                )}
                {pending.name === "create_receipt" && (() => {
                  // Show the exact file that will be stored so you verify the
                  // real evidence, not just the AI-extracted fields.
                  let src: string | null = null;
                  let isPdf = false;
                  for (let i = messages.length - 1; i >= 0 && !src; i--) {
                    const c = messages[i].content;
                    if (!Array.isArray(c)) continue;
                    for (let j = c.length - 1; j >= 0; j--) {
                      const b = c[j];
                      if ((b.type === "image" || b.type === "document") && b.source) {
                        src = `data:${b.source.media_type};base64,${b.source.data}`;
                        isPdf = b.type === "document";
                        break;
                      }
                    }
                  }
                  if (!src) {
                    return <div style={{ fontSize: "0.78rem", color: "#a83232", margin: "0.4rem 0" }}>Nothing attached — Cancel and attach the receipt photo or PDF first.</div>;
                  }
                  return (
                    <div style={{ margin: "0.4rem 0" }}>
                      <div style={{ fontSize: "0.72rem", color: "#666", marginBottom: 4 }}>{isPdf ? "PDF that will be saved:" : "Photo that will be saved:"}</div>
                      {isPdf
                        ? (<>
                            {/* Blob, not a data: URL — multi-MB data: URLs are
                                refused inline by several browsers, which would
                                blank the very check this preview exists for. */}
                            <iframe src={pdfPreviewUrl ?? undefined} title="receipt PDF to save"
                                    style={{ width: "100%", height: 220, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#fff" }} />
                            {pdfPreviewUrl && (
                              <a href={pdfPreviewUrl} target="_blank" rel="noreferrer"
                                 style={{ display: "inline-block", marginTop: 4, fontSize: "0.76rem", color: "#2a6fb0" }}>
                                Open the PDF to check it →
                              </a>
                            )}
                          </>)
                        /* eslint-disable-next-line @next/next/no-img-element */
                        : <img src={src} alt="receipt to save" style={{ maxWidth: "100%", maxHeight: 220, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)" }} />}
                    </div>
                  );
                })()}
                <pre style={{ fontSize: "0.74rem", background: "rgba(0,0,0,0.04)", padding: "0.5rem", borderRadius: 6, overflowX: "auto", margin: "0.4rem 0", whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(pending.input, null, 2)}
                </pre>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {/* Cancel FIRST on a delete, and it takes the primary style —
                      the safe choice should be the one under your thumb. */}
                  {destructive ? (
                    <>
                      <button onClick={() => decide(false)} disabled={busy} style={{ ...primaryBtn, flex: 1 }}>Cancel</button>
                      <button onClick={() => decide(true)} disabled={busy}
                              style={{ ...ghostBtn, flex: 1, color: "#a5281c", borderColor: "#c0392b" }}>Delete permanently</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => decide(true)} disabled={busy} style={{ ...primaryBtn, flex: 1 }}>Confirm</button>
                      <button onClick={() => decide(false)} disabled={busy} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
                    </>
                  )}
                </div>
              </div>
            );
            })()}

            {busy && <div style={{ color: "#999", fontSize: "0.85rem" }}>Thinking…</div>}
            {driveBusy && <div style={{ color: "#999", fontSize: "0.85rem" }}>Opening Google Drive…</div>}
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
            {pdf && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,0.04)", padding: "0.4rem 0.5rem", borderRadius: 10 }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>📕</span>
                <span style={{ fontSize: "0.82rem", color: "#666", flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdf.name}</span>
                  PDF · {Math.max(1, Math.round(pdf.data.length * 0.75 / 1024)).toLocaleString()} KB
                </span>
                <button onClick={() => setPdf(null)} title="Remove" style={iconBtn}>✕</button>
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
                     accept="image/*,.jpg,.jpeg,.png,.gif,.webp,.pdf,.csv,.tsv,.txt,.md,.json,.xlsx,.xls"
                     style={{ display: "none" }}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) attachFile(f); e.target.value = ""; }} />
              {/* One attach control. With Drive configured it opens a two-way
                  menu; without it, it goes straight to the file picker so the
                  click count is unchanged for tenants that don't use Drive. */}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => (driveReady ? setAttachMenu((v) => !v) : fileRef.current?.click())}
                  disabled={busy || driveBusy || !!pending}
                  title={driveReady ? "Attach a file" : "Attach a photo, PDF, spreadsheet (.xlsx), or .csv"}
                  style={iconBtn}
                >📎</button>
                {attachMenu && (
                  <>
                    {/* click-away catcher */}
                    <div onClick={() => setAttachMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                    <div style={{
                      position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 41,
                      background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.14)", overflow: "hidden", minWidth: 190,
                    }}>
                      <button style={menuItem} onClick={() => { setAttachMenu(false); fileRef.current?.click(); }}>
                        💻&nbsp; From my computer
                      </button>
                      <button style={{ ...menuItem, borderTop: "1px solid rgba(0,0,0,0.07)" }}
                              onClick={() => { setAttachMenu(false); attachFromDrive(); }}>
                        🔵&nbsp; From Google Drive
                      </button>
                    </div>
                  </>
                )}
              </div>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                onPaste={onPaste}
                placeholder={pending ? "Confirm or cancel above first…" : "Ask, or attach a photo, PDF or spreadsheet…"}
                disabled={busy || !!pending}
                style={{ flex: 1, padding: "0.7rem 0.9rem", borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)", fontSize: 15 }}
              />
              <button onClick={send} disabled={busy || !!pending || (!input.trim() && !image && !doc && !pdf)} style={primaryBtn}>Send</button>
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

const menuItem: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left", padding: "0.6rem 0.8rem",
  background: "transparent", border: "none", cursor: "pointer", fontSize: "0.88rem", color: "#333",
};

const iconBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#666", width: 28, height: 28 };
const primaryBtn: React.CSSProperties = { background: "linear-gradient(180deg, var(--ra-accent, #e8793a), #c45f20)", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem 1rem", fontWeight: 600, cursor: "pointer", fontSize: 14 };
const ghostBtn: React.CSSProperties = { background: "transparent", color: "#666", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 10, padding: "0.7rem 1rem", fontWeight: 600, cursor: "pointer", fontSize: 14 };

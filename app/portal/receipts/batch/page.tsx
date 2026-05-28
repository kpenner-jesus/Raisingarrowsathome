// /portal/receipts/batch — pick multiple files, fill a row per receipt,
// bulk submit. Less click-y than the one-at-a-time flow.
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/browser";
import { compressImage } from "@/app/portal/_lib/compressImage";

const ALLOWED_MIME_RE = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_AMOUNT = 50_000;

interface Row {
  file: File;
  amount: string;
  currency: "CAD" | "USD";
  date: string;
  description: string;
  status: "ready" | "uploading" | "done" | "error";
  error?: string;
}

function safeExt(name: string): string {
  const parts = name.toLowerCase().split(".");
  if (parts.length < 2) return "";
  const ext = parts[parts.length - 1].replace(/[^a-z0-9]/g, "");
  return ext.length <= 5 ? ext : "";
}
function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return (crypto as any).randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function BatchUploadPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  function addFiles(fl: FileList | null) {
    if (!fl) return;
    const next: Row[] = [];
    for (const f of Array.from(fl)) {
      if (!ALLOWED_MIME_RE.test(f.type)) continue;
      next.push({
        file: f, amount: "", currency: "CAD",
        date: new Date().toISOString().split("T")[0],
        description: "", status: "ready",
      });
    }
    setRows((curr) => [...curr, ...next]);
  }
  function update(i: number, patch: Partial<Row>) {
    setRows((curr) => curr.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function remove(i: number) {
    setRows((curr) => curr.filter((_, idx) => idx !== i));
  }

  async function submitAll() {
    setBusy(true); setSummary(null);
    const supabase = supabaseBrowser();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSummary("Not signed in."); setBusy(false); return; }

    // Resolve tenant ONCE before the loop so every receipt in the batch lands
    // under the same <user_id>/<org_id>/ prefix. Server hard-rejects anything
    // else, so a whoami failure must abort the batch instead of producing N
    // doomed uploads.
    let orgId: string | null = null;
    try {
      const wh = await fetch("/api/portal/whoami", { cache: "no-store" });
      if (wh.ok) orgId = (await wh.json()).org_id || null;
    } catch { /* handled below */ }
    if (!orgId) { setSummary("Couldn't resolve your portal tenant. Refresh the page and try again."); setBusy(false); return; }

    let ok = 0, fail = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.status === "done") { ok++; continue; }
      update(i, { status: "uploading", error: undefined });

      const amt = Number(r.amount);
      if (!Number.isFinite(amt) || amt <= 0 || amt > MAX_AMOUNT) {
        update(i, { status: "error", error: "amount invalid" });
        fail++; continue;
      }

      let processed: File;
      try { processed = await compressImage(r.file); }
      catch { processed = r.file; }
      if (processed.size > MAX_BYTES) {
        update(i, { status: "error", error: "file too large after compression" });
        fail++; continue;
      }
      const ext = safeExt(processed.name);
      if (!ext) {
        update(i, { status: "error", error: "bad extension" });
        fail++; continue;
      }
      const fileBase = `${randomId()}.${ext}`;
      const path = `${user.id}/${orgId}/${fileBase}`;
      const { error: upErr } = await supabase.storage.from("receipts").upload(path, processed, {
        contentType: processed.type, cacheControl: "0", upsert: false,
      });
      if (upErr) { update(i, { status: "error", error: upErr.message }); fail++; continue; }

      const res = await fetch("/api/portal/receipts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_path: path, amount: amt, currency: r.currency,
          purchase_date: r.date, description: r.description,
        }),
      });
      if (!res.ok) {
        update(i, { status: "error", error: await res.text() });
        fail++; continue;
      }
      update(i, { status: "done" });
      ok++;
    }
    setBusy(false);
    setSummary(`Submitted ${ok}/${rows.length}.${fail > 0 ? ` ${fail} failed — fix errors below and resubmit.` : ""}`);
    if (fail === 0) setTimeout(() => router.push("/portal"), 1200);
  }

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", marginBottom: "0.5rem" }}>Batch upload receipts</h1>
      <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: "1.5rem" }}>
        Pick all your receipts at once, fill in amount/date/description for each, then submit the whole batch.
      </p>

      <div style={{ marginBottom: "1.5rem" }}>
        <label className="tf-input-box" style={{ display: "inline-block", padding: "0.85rem 1.4rem", cursor: "pointer" }}>
          <input type="file" multiple accept="image/*,application/pdf"
            onChange={(e) => addFiles(e.target.files)}
            style={{ display: "none" }} />
          + Add receipts ({rows.length} queued)
        </label>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>No receipts queued. Tap the button above to pick files.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          {rows.map((r, i) => (
            <div key={i} style={{
              padding: "0.85rem 1rem", borderRadius: 10,
              border: r.status === "done"  ? "1px solid var(--success)"
                    : r.status === "error" ? "1px solid var(--danger)"
                    :                       "1px solid rgba(0,0,0,0.08)",
              background: "rgba(255,255,255,0.85)",
              display: "grid", gridTemplateColumns: "1fr 110px 110px 130px auto", gap: "0.5rem",
            }}>
              <div style={{ gridColumn: "1 / -1", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                {r.file.name} · {(r.file.size/1024).toFixed(0)} KB
                {r.status === "uploading" && <em style={{ marginLeft: 8 }}>uploading…</em>}
                {r.status === "done"      && <em style={{ marginLeft: 8, color: "var(--success)" }}>done ✓</em>}
                {r.status === "error"     && <em style={{ marginLeft: 8, color: "var(--danger)" }}>error: {r.error}</em>}
              </div>
              <input className="tf-input-box" placeholder="Description" maxLength={500}
                value={r.description} onChange={(e) => update(i, { description: e.target.value })} />
              <input className="tf-input-box" type="number" step="0.01" min={0} placeholder="Amount"
                value={r.amount} onChange={(e) => update(i, { amount: e.target.value })} />
              <select className="tf-input-box" value={r.currency}
                onChange={(e) => update(i, { currency: e.target.value as any })}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
              <input className="tf-input-box" type="date" value={r.date}
                onChange={(e) => update(i, { date: e.target.value })} />
              <button className="ra-btn" onClick={() => remove(i)} disabled={busy || r.status === "done"}
                style={{ fontSize: "0.8rem" }}>×</button>
            </div>
          ))}
        </div>
      )}

      {summary && <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "rgba(0,0,0,0.04)", borderRadius: 8 }}>{summary}</div>}

      {rows.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <button className="tf-ok" disabled={busy} onClick={submitAll}>
            {busy ? "Submitting…" : `Submit all (${rows.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

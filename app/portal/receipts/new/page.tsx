"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/browser";

const ALLOWED_EXTS    = ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"];
const ALLOWED_MIME_RE = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i;
const MAX_BYTES       = 8 * 1024 * 1024;
const MAX_AMOUNT      = 50_000;

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

export default function NewReceiptPage() {
  const router = useRouter();
  const [file, setFile]               = useState<File | null>(null);
  const [amount, setAmount]           = useState("");
  const [currency, setCurrency]       = useState<"CAD" | "USD">("CAD");
  const [date, setDate]               = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");

  const upload = async () => {
    if (!file) { setError("Please attach a photo or PDF of the receipt."); return; }
    if (file.size > MAX_BYTES) { setError("File too large — please keep under 8 MB."); return; }
    if (!ALLOWED_MIME_RE.test(file.type)) {
      setError("Only JPG, PNG, WebP, HEIC, or PDF files are allowed.");
      return;
    }
    const ext = safeExt(file.name);
    if (!ALLOWED_EXTS.includes(ext)) { setError("File extension not allowed."); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError("Please enter a positive amount."); return; }
    if (amt > MAX_AMOUNT)                    { setError(`Amount can't exceed $${MAX_AMOUNT.toLocaleString()}.`); return; }

    setBusy(true); setError("");
    const supabase = supabaseBrowser();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in."); setBusy(false); return; }

    const path = `${user.id}/${randomId()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("receipts").upload(path, file, {
      contentType: file.type, cacheControl: "0", upsert: false,
    });
    if (upErr) { setError(upErr.message); setBusy(false); return; }

    const res = await fetch("/api/portal/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_path: path,
        amount: amt,
        currency,
        purchase_date: date,
        description,
      }),
    });
    setBusy(false);
    if (!res.ok) { setError(await res.text()); return; }
    router.push("/portal");
  };

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", marginBottom: "1rem" }}>Upload a receipt</h1>

      <div style={{
        background: "rgba(232,121,58,0.08)",
        border: "1px solid rgba(232,121,58,0.25)",
        borderRadius: 10, padding: "0.85rem 1.1rem", marginBottom: "1.5rem",
        fontSize: "0.88rem", lineHeight: 1.55, color: "var(--text-primary)",
      }}>
        <strong>What we reimburse:</strong> curriculum, workbooks, and educational books.{" "}
        <em>Not</em> field trips, supplies, or extracurricular fees.
      </div>

      <p style={{ color: "var(--text-secondary)", marginBottom: "2rem", lineHeight: 1.6 }}>
        Snap a photo of your receipt, enter the amount in the original currency, and submit. Once approved, the eligible portion is added to your next monthly payout (15th or end of month — submit at least 2 weeks in advance to make a payout window).
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={lbl}>Receipt photo or PDF</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ display: "block", fontSize: "0.9rem" }}
          />
          {file && <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>{file.name} · {(file.size/1024).toFixed(0)} KB</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: "0.75rem" }}>
          <div>
            <label style={lbl}>Amount</label>
            <input type="number" step="0.01" min="0" max={MAX_AMOUNT} value={amount} onChange={(e) => setAmount(e.target.value)} className="tf-input-box" placeholder="e.g. 124.99" />
          </div>
          <div>
            <label style={lbl}>Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as any)} className="tf-input-box" style={{ height: "auto" }}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
        {currency === "USD" && (
          <div className="tf-alert-error" style={{ background: "rgba(232,121,58,0.08)", color: "var(--text-primary)", border: "1px solid rgba(232,121,58,0.25)" }}>
            USD receipts: we&apos;ll convert to CAD at approval. No exchange rate calculation needed from you.
          </div>
        )}

        <div>
          <label style={lbl}>Purchase date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="tf-input-box" />
        </div>
        <div>
          <label style={lbl}>Description (curriculum name, store, etc.)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="tf-input-box" placeholder="e.g. Sonlight Core A package — Amazon.ca" maxLength={500} />
        </div>
        {error && <div className="tf-alert-error">{error}</div>}
        <button className="tf-ok" disabled={busy} onClick={upload} style={{ marginTop: "0.5rem", alignSelf: "flex-start" }}>
          {busy ? "Uploading…" : "Submit receipt"}
        </button>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = {
  display: "block", fontSize: "0.72rem", textTransform: "uppercase",
  letterSpacing: "0.08em", color: "var(--text-muted)",
  marginBottom: "0.4rem", fontWeight: 600,
};

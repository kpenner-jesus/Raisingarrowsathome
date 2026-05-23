"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/browser";

export default function NewReceiptPage() {
  const router = useRouter();
  const [file, setFile]               = useState<File | null>(null);
  const [amount, setAmount]           = useState("");
  const [date, setDate]               = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState("");

  const upload = async () => {
    if (!file)                              { setError("Please attach a photo or PDF of the receipt."); return; }
    if (!amount || Number(amount) <= 0)     { setError("Please enter the receipt amount."); return; }
    if (file.size > 8 * 1024 * 1024)        { setError("File is too large. Please keep it under 8 MB."); return; }

    setBusy(true); setError("");
    const supabase = supabaseBrowser();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in."); setBusy(false); return; }

    const ext  = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${user.id}/${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage.from("receipts").upload(path, file, { contentType: file.type });
    if (upErr) { setError(upErr.message); setBusy(false); return; }

    const res = await fetch("/api/portal/receipts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_path: path,
        amount: Number(amount),
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
      <p style={{ color: "var(--text-secondary)", marginBottom: "2rem", lineHeight: 1.6 }}>
        Snap a photo of your receipt, enter the amount, and submit. Once it&apos;s approved,
        the eligible portion will be added to your next monthly payout.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={lbl}>Receipt photo or PDF</label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ display: "block", fontSize: "0.9rem" }}
          />
          {file && <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>{file.name} · {(file.size/1024).toFixed(0)} KB</div>}
        </div>
        <div>
          <label style={lbl}>Amount (CAD)</label>
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="tf-input-box" placeholder="e.g. 124.99" />
        </div>
        <div>
          <label style={lbl}>Purchase date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="tf-input-box" />
        </div>
        <div>
          <label style={lbl}>Description (curriculum name, store, etc.)</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="tf-input-box" placeholder="e.g. Sonlight Core A package — Amazon.ca" />
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
  display: "block",
  fontSize: "0.72rem",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-muted)",
  marginBottom: "0.4rem",
  fontWeight: 600,
};

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/browser";

const ALLOWED_EXTS    = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
const ALLOWED_MIME_RE = /^image\/(jpeg|png|webp|heic|heif)$/i;
const MAX_BYTES       = 8 * 1024 * 1024;

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

export default function NewPhotoPage() {
  const router = useRouter();
  const [file, setFile]       = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState("");

  const upload = async () => {
    if (!file) { setError("Please choose a photo."); return; }
    if (file.size > MAX_BYTES) { setError("File too large — please keep under 8 MB."); return; }
    if (!ALLOWED_MIME_RE.test(file.type)) {
      setError("Only JPG, PNG, WebP, or HEIC images are allowed.");
      return;
    }
    const ext = safeExt(file.name);
    if (!ALLOWED_EXTS.includes(ext)) {
      setError("File extension not allowed.");
      return;
    }

    setBusy(true); setError("");
    const supabase = supabaseBrowser();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in."); setBusy(false); return; }

    const path = `${user.id}/${randomId()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("photos").upload(path, file, {
      contentType: file.type,
      cacheControl: "0",
      upsert: false,
    });
    if (upErr) { setError(upErr.message); setBusy(false); return; }

    const res = await fetch("/api/portal/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_path: path, caption }),
    });
    setBusy(false);
    if (!res.ok) { setError(await res.text()); return; }
    router.push("/portal/photos");
  };

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", marginBottom: "0.75rem" }}>Upload a photo</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "2rem", lineHeight: 1.6 }}>
        Share a snapshot from your homeschool journey — books in action, a field trip, a milestone. Photos help us tell your family&apos;s story.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={lbl}>Photo</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ display: "block", fontSize: "0.9rem" }}
          />
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.35rem", lineHeight: 1.5 }}>
            📷 On your phone, tap to <strong>take a photo</strong> or pick one from your library.
          </div>
          {file && <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>{file.name} · {(file.size/1024).toFixed(0)} KB</div>}
        </div>
        <div>
          <label style={lbl}>Caption (optional)</label>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} className="tf-input-box" placeholder="e.g. First day of homeschool!" maxLength={300} />
        </div>
        {error && <div className="tf-alert-error">{error}</div>}
        <button className="tf-ok" disabled={busy} onClick={upload} style={{ alignSelf: "flex-start" }}>
          {busy ? "Uploading…" : "Submit photo"}
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

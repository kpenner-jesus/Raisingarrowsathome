"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/browser";

export default function NewPhotoPage() {
  const router = useRouter();
  const [file, setFile]       = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState("");

  const upload = async () => {
    if (!file) { setError("Please choose a photo."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("File too large — please keep under 8 MB."); return; }

    setBusy(true); setError("");
    const supabase = supabaseBrowser();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Not signed in."); setBusy(false); return; }

    const ext  = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("photos").upload(path, file, { contentType: file.type });
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
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ display: "block", fontSize: "0.9rem" }} />
          {file && <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>{file.name} · {(file.size/1024).toFixed(0)} KB</div>}
        </div>
        <div>
          <label style={lbl}>Caption (optional)</label>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} className="tf-input-box" placeholder="e.g. First day of homeschool!" />
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

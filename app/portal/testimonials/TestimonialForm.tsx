"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TestimonialForm() {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true); setError("");
    const res = await fetch("/api/portal/testimonials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (!res.ok) { setError(await res.text()); return; }
    setBody("");
    router.refresh();
  };

  return (
    <div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        className="tf-input-box"
        style={{ resize: "vertical", minHeight: 140 }}
        placeholder="How is homeschooling going for your family? What has surprised you, encouraged you, or challenged you?"
      />
      {error && <div className="tf-alert-error" style={{ marginTop: "0.75rem" }}>{error}</div>}
      <button className="tf-ok" disabled={busy || !body.trim()} onClick={submit} style={{ marginTop: "0.75rem" }}>
        {busy ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}

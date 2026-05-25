"use client";
// Owner-only form for logo URL + accent colour. Submits to
// /api/admin/branding. Shows a live preview with the chosen values.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BrandingForm({
  orgId, initialLogoUrl, initialBrandColor, orgName,
}: {
  orgId: string;
  initialLogoUrl: string;
  initialBrandColor: string;
  orgName: string;
}) {
  const router = useRouter();
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [brandColor, setBrandColor] = useState(initialBrandColor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      const r = await fetch("/api/admin/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, logo_url: logoUrl.trim() || null, brand_color: brandColor }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setSaved(true);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="ra-card" style={{ marginBottom: "1.25rem" }}>
        <h2 className="ra-section-title">Logo</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "0.85rem", lineHeight: 1.5 }}>
          Paste a URL to your logo (PNG or SVG works best, square or landscape).
          Host it on your own site, Imgur, Cloudinary, etc.
          Direct file upload coming soon.
        </p>
        <input
          type="url"
          value={logoUrl}
          onChange={(e) => { setLogoUrl(e.target.value); setError(null); setSaved(false); }}
          placeholder="https://yourchurch.org/logo.png"
          className="ra-input"
          style={{ width: "100%", marginBottom: "0.5rem" }}
        />
      </section>

      <section className="ra-card" style={{ marginBottom: "1.25rem" }}>
        <h2 className="ra-section-title">Accent colour</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "0.85rem", lineHeight: 1.5 }}>
          Used for buttons, links, highlights. Pick a brand colour that contrasts well on white.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="color"
            value={brandColor}
            onChange={(e) => { setBrandColor(e.target.value); setError(null); setSaved(false); }}
            style={{ width: 56, height: 56, borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)", cursor: "pointer", padding: 0 }}
          />
          <input
            type="text"
            value={brandColor}
            onChange={(e) => { setBrandColor(e.target.value); setError(null); setSaved(false); }}
            placeholder="#e8793a"
            pattern="^#[0-9a-fA-F]{6}$"
            className="ra-input"
            style={{ width: 140, fontFamily: "ui-monospace, monospace" }}
          />
        </div>
      </section>

      <section className="ra-card" style={{ marginBottom: "1.25rem" }}>
        <h2 className="ra-section-title">Preview</h2>
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, padding: "1.5rem", textAlign: "center" }}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={orgName}
              style={{ maxHeight: 56, maxWidth: 240, display: "inline-block", marginBottom: "0.75rem" }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontStyle: "italic", marginBottom: "0.75rem", color: brandColor }}>
              {orgName}
            </div>
          )}
          <button
            style={{
              background: brandColor, color: "#fff", border: "none",
              padding: "0.7rem 1.4rem", borderRadius: 100, fontWeight: 600, fontSize: "0.92rem",
              cursor: "default",
            }}
            type="button"
          >
            Apply for a Grant
          </button>
        </div>
      </section>

      {error && <div className="ra-alert-error" style={{ marginBottom: "0.85rem" }}>{error}</div>}
      {saved && <div className="ra-alert-success" style={{ marginBottom: "0.85rem" }}>Saved. Refresh the page on another tab to see the change.</div>}

      <button
        onClick={save}
        disabled={busy}
        className="ra-btn ra-btn-primary"
        style={{
          background: brandColor, color: "#fff", border: "none",
          padding: "0.85rem 1.5rem", borderRadius: 100, fontWeight: 600, fontSize: "0.95rem",
          minHeight: 52, cursor: "pointer",
        }}
      >
        {busy ? "Saving…" : "Save branding"}
      </button>
    </>
  );
}

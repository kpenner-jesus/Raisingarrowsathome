"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Item {
  id: string;
  body: string;
  status: "pending" | "approved" | "hidden";
  featured: boolean;
  created_at: string;
  recipients?: { applications?: { parent_names?: string; app_ref?: string; city?: string; province?: string } };
}

export function TestimonialManager({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(id: string, patch: { status?: string; featured?: boolean }) {
    setBusyId(id); setError(null);
    try {
      const r = await fetch(`/api/admin/testimonials/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed");
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="ra-card ra-empty">
        <div className="ra-empty-icon">”</div>
        <div className="ra-empty-title">Nothing in this bucket</div>
        <div>When recipients submit testimonials they show up here.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      {error && <div className="ra-alert-error">{error}</div>}
      {items.map((t) => {
        const fam = t.recipients?.applications?.parent_names ?? "(unknown family)";
        const ref = t.recipients?.applications?.app_ref ?? "";
        const place = [t.recipients?.applications?.city, t.recipients?.applications?.province].filter(Boolean).join(", ");
        const busy = busyId === t.id;
        return (
          <article key={t.id} className="ra-card" style={{ padding: "1.2rem 1.3rem" }}>
            <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", marginBottom: "0.6rem" }}>
              <div>
                <strong style={{ fontWeight: 500 }}>{fam}</strong>{" "}
                <span className="ra-tiny">· {ref}{place ? ` · ${place}` : ""}</span>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <span className={`ra-badge ra-badge-${t.status === "approved" ? "approved" : t.status === "hidden" ? "denied" : "pending"}`}>
                  {t.status}
                </span>
                {t.featured && <span className="ra-badge ra-badge-pending" style={{ background: "rgba(232,121,58,0.18)" }}>★ featured</span>}
              </div>
            </header>

            <blockquote style={{ fontSize: "1rem", lineHeight: 1.6, color: "var(--ra-ink-soft)", margin: "0 0 1rem", padding: 0, fontStyle: "italic" }}>
              “{t.body}”
            </blockquote>

            <div className="ra-tiny" style={{ marginBottom: "0.6rem" }}>Submitted {new Date(t.created_at).toLocaleDateString()}</div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {t.status !== "approved" && (
                <button className="ra-btn ra-btn-primary" disabled={busy} onClick={() => update(t.id, { status: "approved" })}>
                  {busy ? "..." : "Approve"}
                </button>
              )}
              {t.status === "approved" && (
                <button className="ra-btn" disabled={busy} onClick={() => update(t.id, { featured: !t.featured })}>
                  {busy ? "..." : t.featured ? "Unfeature" : "Feature ★"}
                </button>
              )}
              {t.status !== "hidden" && (
                <button className="ra-btn" disabled={busy} onClick={() => update(t.id, { status: "hidden" })}>
                  {busy ? "..." : "Hide"}
                </button>
              )}
              {t.status === "hidden" && (
                <button className="ra-btn" disabled={busy} onClick={() => update(t.id, { status: "pending" })}>
                  {busy ? "..." : "Return to pending"}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

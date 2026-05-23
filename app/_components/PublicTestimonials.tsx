"use client";
import { useEffect, useRef, useState } from "react";

export interface PublicTestimonial {
  id: string;
  body: string;
  attribution: string;     // e.g. "Sarah & Tim · Winnipeg"
  featured: boolean;
}

/** Self-fetching carousel — pulls from /api/public/testimonials on mount.
 *  Renders nothing if there are no approved testimonials yet. */
export function PublicTestimonials() {
  const [items, setItems] = useState<PublicTestimonial[]>([]);
  const [idx, setIdx] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/testimonials");
        const j = await res.json();
        if (!cancelled && Array.isArray(j?.items)) setItems(j.items);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (items.length < 2) return;
    timerRef.current = setInterval(() => {
      setIdx((i) => (i + 1) % items.length);
    }, 7000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [items.length]);

  if (items.length === 0) return null;
  const t = items[idx];

  return (
    <section style={{
      padding: "4rem 1.5rem 5rem",
      background: "linear-gradient(180deg, transparent 0%, rgba(232,121,58,0.04) 100%)",
      borderTop: "1px solid rgba(0,0,0,0.05)",
    }}>
      <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
        <div style={{
          fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em",
          textTransform: "uppercase", color: "var(--accent)", marginBottom: "1rem",
        }}>
          Families we have walked with
        </div>

        <blockquote
          key={t.id}  // re-mounts on change so the fade replays
          style={{
            fontFamily: "var(--font-display)", fontStyle: "italic",
            fontSize: "clamp(1.15rem, 2.6vw, 1.55rem)", lineHeight: 1.5,
            color: "var(--text-primary)", margin: 0, padding: 0,
            animation: "raTestimonialFade 0.8s ease-out",
          }}
        >
          “{t.body}”
        </blockquote>

        <div style={{ marginTop: "1rem", fontSize: "0.92rem", color: "var(--text-muted)" }}>
          — {t.attribution}
        </div>

        {items.length > 1 && (
          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.4rem", justifyContent: "center" }}>
            {items.map((it, i) => (
              <button
                key={it.id}
                aria-label={`Show testimonial ${i + 1}`}
                onClick={() => setIdx(i)}
                style={{
                  width: 7, height: 7, borderRadius: "50%",
                  border: "none",
                  background: i === idx ? "var(--accent)" : "rgba(0,0,0,0.18)",
                  cursor: "pointer", padding: 0,
                  transition: "background 0.2s",
                }}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes raTestimonialFade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}

"use client";
import { useEffect, useState } from "react";
import { SITE_CONFIG } from "@/app/siteConfig";
import { Kid, PERSONALITIES } from "./Kids";

const TIER_DETAILS = [
  {
    label: "Ages 5–8",
    title: "Just starting out",
    body: [
      "These are the foundation years — phonics, beginner readers, hands-on math, lots of read-alouds.",
      "Our $375 reimbursement is sized for the typical first-year spend at this stage: an early-elementary curriculum bundle plus a few key workbooks.",
      "Most families in this age range spend around $500 in their first year. You'd be reimbursed for 75% of qualifying purchases up to the cap.",
    ],
  },
  {
    label: "Ages 8–12",
    title: "Hitting their stride",
    body: [
      "Independent readers, beginner writing programs, geography and history come alive at this age.",
      "The $500 reimbursement covers a more developed curriculum — math, language arts, science, and history materials.",
      "Typical first-year spend at this age: $667. We reimburse 75% up to $500.",
    ],
  },
  {
    label: "Ages 12–15",
    title: "Stretching toward high school",
    body: [
      "Pre-algebra, demanding history and literature, science with experiments. The shelf gets fuller.",
      "$650 stretches to a comprehensive middle-school curriculum + supporting workbooks and reference books.",
      "Families usually spend around $867 to outfit a middle-schooler. We cover 75% up to the cap.",
    ],
  },
  {
    label: "Ages 15–18",
    title: "High-school ready",
    body: [
      "High-school transcripts, advanced math, science with lab materials, foreign language.",
      "$750 covers a full year of secondary curriculum plus the books and lab materials a teen needs to graduate well-equipped.",
      "Average outlay at this level: $1,000. We reimburse 75% up to the cap.",
    ],
  },
];

function randIn([min, max]: [number, number]): number {
  return min + Math.random() * (max - min);
}

interface PeekState { active: boolean; height: number; tilt: number; }
const idleState: PeekState = { active: false, height: 0, tilt: 0 };

export function PeekingChildren() {
  const tiers = SITE_CONFIG.fundingCaps;
  const [peekStates, setPeekStates] = useState<PeekState[]>(tiers.map(() => idleState));
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedulePeek = (i: number) => {
      const p = PERSONALITIES[i] || PERSONALITIES[0];
      const initialDelay = 1500 + Math.random() * 5000;
      const cycle = () => {
        const height = randIn(p.heightRange);
        const tilt   = randIn(p.tiltRange);
        setPeekStates((curr) => { const next = [...curr]; next[i] = { active: true, height, tilt }; return next; });
        const visibleFor = 2200 + Math.random() * 1500;
        timers.push(setTimeout(() => {
          setPeekStates((curr) => { const next = [...curr]; next[i] = idleState; return next; });
          const gap = 5000 + Math.random() * 8000;
          timers.push(setTimeout(cycle, gap));
        }, visibleFor));
      };
      timers.push(setTimeout(cycle, initialDelay));
    };
    tiers.forEach((_, i) => schedulePeek(i));
    return () => timers.forEach(clearTimeout);
  }, [tiers.length]);

  useEffect(() => {
    if (zoom === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoom(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  return (
    <>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "0.75rem",
        marginBottom: "3rem",
      }}>
        {tiers.map((tier, i) => {
          const p = PERSONALITIES[i] || PERSONALITIES[0];
          const state = peekStates[i] || idleState;
          const idleTransform = `translate(-50%, 75%) rotate(0deg)`;
          const peekTransform = `translate(-50%, -${state.height.toFixed(1)}%) rotate(${state.tilt.toFixed(1)}deg)`;
          return (
            <div key={tier.label} style={{ position: "relative" }}>
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  left: "50%",
                  width: 72,
                  height: 110,
                  transform: state.active ? peekTransform : idleTransform,
                  transition: "transform 0.95s cubic-bezier(0.34, 1.5, 0.64, 1)",
                  pointerEvents: "none",
                  zIndex: 1,
                }}
              >
                <Kid variant={i} blinks={p.blinks} blinkDelay={p.blinkDelay} lookAround={i === 2} />
              </div>

              <button
                onClick={() => setZoom(i)}
                aria-label={`Learn more about ${tier.label}`}
                style={{
                  position: "relative",
                  zIndex: 2,
                  width: "100%",
                  background: "#fefaf3",
                  border: "1.5px solid rgba(0,0,0,0.09)",
                  borderRadius: "var(--radius-lg)",
                  padding: "1.25rem 1rem 1.4rem",
                  textAlign: "center",
                  boxShadow: "var(--shadow-card)",
                  cursor: "pointer",
                  transition: "transform 0.18s cubic-bezier(0.4,0,0.2,1), box-shadow 0.18s",
                  fontFamily: "var(--font-body)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-card)"; }}
              >
                <div style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  {tier.label}
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", fontWeight: 500, color: "var(--accent)", lineHeight: 1 }}>
                  ${tier.cap}
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  reimbursed
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                  (you spend ${tier.spend})
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--accent)", marginTop: "0.55rem", fontWeight: 500 }}>
                  Tap to learn more →
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {zoom !== null && (
        <ZoomCard
          tier={tiers[zoom]}
          detail={TIER_DETAILS[zoom]}
          variant={zoom}
          onClose={() => setZoom(null)}
        />
      )}
    </>
  );
}

function ZoomCard({
  tier, detail, variant, onClose,
}: {
  tier: { label: string; cap: number; spend: number };
  detail: typeof TIER_DETAILS[number];
  variant: number;
  onClose: () => void;
}) {
  const p = PERSONALITIES[variant] || PERSONALITIES[0];
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(20,16,12,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: "1.5rem",
        animation: "raFade 0.18s ease-out",
      }}
      role="dialog" aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(180deg, #fdf3e3 0%, #ffffff 60%)",
          borderRadius: "var(--radius-xl)",
          maxWidth: 460, width: "100%",
          padding: "2rem 1.75rem 1.75rem",
          boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
          position: "relative",
          animation: "raZoomIn 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: 12, right: 12,
            width: 30, height: 30, borderRadius: "50%",
            border: "1px solid rgba(0,0,0,0.1)",
            background: "rgba(255,255,255,0.9)",
            cursor: "pointer", fontSize: "1.05rem", lineHeight: 1,
            color: "var(--text-muted)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >×</button>

        <div style={{
          margin: "0 auto 0.75rem",
          width: 120, height: 140,
          animation: "raBreathe 3s ease-in-out infinite",
          transformOrigin: "bottom center",
        }} aria-hidden>
          <Kid variant={variant} blinks blinkDelay={p.blinkDelay} lookAround={false} />
        </div>

        <div style={{ textAlign: "center", marginBottom: "1rem" }}>
          <div style={{
            fontSize: "0.7rem", fontWeight: 600, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "var(--accent)",
            marginBottom: "0.3rem",
          }}>
            {tier.label}
          </div>
          <h2 style={{
            fontFamily: "var(--font-display)", fontSize: "1.6rem",
            fontWeight: 500, color: "var(--text-primary)",
            margin: 0, lineHeight: 1.2,
          }}>
            {detail.title}
          </h2>
        </div>

        <div style={{
          background: "rgba(255,255,255,0.7)",
          border: "1px solid rgba(232,121,58,0.22)",
          borderRadius: "var(--radius-lg)",
          padding: "0.85rem 1.1rem",
          marginBottom: "1.25rem",
          display: "flex", justifyContent: "space-around", alignItems: "center",
          gap: "0.5rem",
          textAlign: "center",
        }}>
          <div>
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.15rem" }}>You spend</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--text-primary)", lineHeight: 1 }}>${tier.spend}</div>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: "1.4rem" }}>→</div>
          <div>
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.15rem" }}>We reimburse</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", color: "var(--accent)", lineHeight: 1 }}>${tier.cap}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem", marginBottom: "1.25rem" }}>
          {detail.body.map((paragraph, i) => (
            <p key={i} style={{ fontSize: "0.92rem", color: "var(--text-secondary)", lineHeight: 1.65, margin: 0, fontWeight: 300 }}>
              {paragraph}
            </p>
          ))}
        </div>

        <a
          href="/apply/family"
          style={{
            display: "block",
            background: "var(--text-primary)",
            color: "#fff",
            textAlign: "center",
            padding: "0.85rem 1.5rem",
            borderRadius: 100,
            textDecoration: "none",
            fontWeight: 500,
            fontSize: "0.92rem",
          }}
        >
          Apply for this grant →
        </a>
      </div>

      <style>{`
        @keyframes raFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes raZoomIn {
          from { transform: translateY(12px) scale(0.94); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes raBreathe {
          0%, 100% { transform: scale(1) translateY(0); }
          50%      { transform: scale(1.04) translateY(-3px); }
        }
      `}</style>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { SITE_CONFIG } from "@/app/siteConfig";

// ============================================================
//  PeekingChildren — playful age-tier cards on the landing page.
//
//  Each card has a stylized SVG kid sitting BEHIND it. Heads pop up
//  above the card edge at independent random intervals. Each kid has
//  its own personality: tilts, blinks, peek-height, look-around.
//
//  Clicking a card opens a zoom modal with a longer description +
//  the same cartoon, gently "breathing" (subtle scale loop).
// ============================================================

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

// Per-variant personality
const PERSONALITIES = [
  { tilt:  -6, peekHeight:  46, blinks: true,  blinkDelay: "1.4s" }, // pigtails — gentle left tilt
  { tilt:   4, peekHeight:  40, blinks: false, blinkDelay: "0s"   }, // cap — straight, no blink
  { tilt:  -2, peekHeight:  52, blinks: true,  blinkDelay: "3.2s" }, // glasses — peeks highest, blinks
  { tilt:   7, peekHeight:  44, blinks: true,  blinkDelay: "5.7s" }, // hoodie — right tilt, late blink
];

export function PeekingChildren() {
  const tiers = SITE_CONFIG.fundingCaps;
  const [peeking, setPeeking] = useState<boolean[]>(tiers.map(() => false));
  const [zoom, setZoom] = useState<number | null>(null);

  // Independent peek schedules per child
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedulePeek = (i: number) => {
      const initialDelay = 1500 + Math.random() * 5000;
      const cycle = () => {
        setPeeking((p) => { const next = [...p]; next[i] = true; return next; });
        const visibleFor = 2200 + Math.random() * 1200;
        timers.push(setTimeout(() => {
          setPeeking((p) => { const next = [...p]; next[i] = false; return next; });
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
      <style>{`
        @keyframes raBlink {
          0%, 92%, 100% { transform: scaleY(1); }
          94%, 96%      { transform: scaleY(0.05); }
        }
        @keyframes raLookAround {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(2px); }
        }
        .ra-eye-blink {
          transform-origin: center;
          transform-box: fill-box;
          animation: raBlink 4.2s infinite;
        }
        .ra-look-around {
          animation: raLookAround 5s ease-in-out infinite;
        }
      `}</style>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "0.75rem",
        marginBottom: "3rem",
      }}>
        {tiers.map((tier, i) => {
          const p = PERSONALITIES[i] || PERSONALITIES[0];
          const isPeeking = peeking[i];
          // When idle: head sits behind the card top, mostly hidden
          // When peeking: head pops above with a tilt
          const idleTransform   = `translate(-50%, 60%) rotate(0deg)`;
          const peekTransform   = `translate(-50%, -${p.peekHeight}%) rotate(${p.tilt}deg)`;
          return (
            <div key={tier.label} style={{ position: "relative" }}>
              {/* Peeking child — sits BEHIND the card */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  left: "50%",
                  width: 56,
                  height: 78,
                  transform: isPeeking ? peekTransform : idleTransform,
                  transition: "transform 0.85s cubic-bezier(0.34, 1.5, 0.64, 1)",
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

// ──────────────────────────────────────────────────────────────
//  Kid SVG — 4 variants with optional blinking + look-around
// ──────────────────────────────────────────────────────────────

interface KidProps {
  variant: number;
  blinks?: boolean;
  blinkDelay?: string;
  lookAround?: boolean;
}

function Kid({ variant, blinks, blinkDelay, lookAround }: KidProps) {
  const eyeProps = blinks
    ? { className: "ra-eye-blink", style: { animationDelay: blinkDelay } as React.CSSProperties }
    : {};
  const lookProps = lookAround ? { className: "ra-look-around" } : {};

  switch (variant) {
    case 0: return <KidPigtails eyeProps={eyeProps} lookProps={lookProps} />;
    case 1: return <KidCap      eyeProps={eyeProps} lookProps={lookProps} />;
    case 2: return <KidGlasses  eyeProps={eyeProps} lookProps={lookProps} />;
    case 3: return <KidHoodie   eyeProps={eyeProps} lookProps={lookProps} />;
    default: return <KidPigtails eyeProps={eyeProps} lookProps={lookProps} />;
  }
}

type SubProps = { eyeProps: any; lookProps: any };

function KidPigtails({ eyeProps, lookProps }: SubProps) {
  return (
    <svg viewBox="0 0 60 80" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      {/* pigtails */}
      <ellipse cx="10" cy="32" rx="8" ry="11" fill="#a86b3a" />
      <ellipse cx="50" cy="32" rx="8" ry="11" fill="#a86b3a" />
      {/* pigtail bows */}
      <circle cx="10" cy="22" r="2.5" fill="#e8793a" />
      <circle cx="50" cy="22" r="2.5" fill="#e8793a" />
      {/* head */}
      <ellipse cx="30" cy="35" rx="18" ry="20" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      {/* hair fringe */}
      <path d="M 14 24 Q 30 12 46 24 Q 42 28 30 27 Q 18 28 14 24 Z" fill="#a86b3a" />
      {/* eyes (blink-able) */}
      <g {...lookProps}>
        <circle cx="22" cy="35" r="2.2" fill="#1a1a1a" {...eyeProps} />
        <circle cx="38" cy="35" r="2.2" fill="#1a1a1a" {...eyeProps} />
      </g>
      {/* eye highlights */}
      <circle cx="22.7" cy="34.3" r="0.7" fill="#fff" />
      <circle cx="38.7" cy="34.3" r="0.7" fill="#fff" />
      {/* cheeks */}
      <circle cx="17" cy="42" r="2.5" fill="#f5a78a" opacity="0.55" />
      <circle cx="43" cy="42" r="2.5" fill="#f5a78a" opacity="0.55" />
      {/* mouth */}
      <path d="M 25 44 Q 30 48 35 44" stroke="#1a1a1a" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function KidCap({ eyeProps, lookProps }: SubProps) {
  return (
    <svg viewBox="0 0 60 80" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <ellipse cx="30" cy="38" rx="17" ry="19" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 14 32 Q 30 28 46 32 L 46 38 Q 30 36 14 38 Z" fill="#3a2618" />
      {/* cap */}
      <path d="M 11 28 Q 30 12 49 28 L 49 30 L 11 30 Z" fill="#e8793a" stroke="#1a1a1a" strokeWidth="1.2" />
      <ellipse cx="30" cy="30" rx="22" ry="3" fill="#c45f20" stroke="#1a1a1a" strokeWidth="1.2" />
      {/* tiny cap logo */}
      <circle cx="30" cy="22" r="2.2" fill="#fff" opacity="0.7" />
      {/* eyes */}
      <g {...lookProps}>
        <circle cx="23" cy="40" r="2" fill="#1a1a1a" {...eyeProps} />
        <circle cx="37" cy="40" r="2" fill="#1a1a1a" {...eyeProps} />
      </g>
      <circle cx="23.6" cy="39.5" r="0.6" fill="#fff" />
      <circle cx="37.6" cy="39.5" r="0.6" fill="#fff" />
      {/* freckles */}
      <circle cx="20" cy="44" r="0.6" fill="#a86b3a" />
      <circle cx="24" cy="46" r="0.6" fill="#a86b3a" />
      <circle cx="36" cy="46" r="0.6" fill="#a86b3a" />
      <circle cx="40" cy="44" r="0.6" fill="#a86b3a" />
      {/* mouth — big toothy grin */}
      <path d="M 26 50 Q 30 54 34 50" stroke="#1a1a1a" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M 28 50.5 L 28 52.5 L 32 52.5 L 32 50.5 Z" fill="#fff" stroke="#1a1a1a" strokeWidth="0.6" />
    </svg>
  );
}

function KidGlasses({ eyeProps, lookProps }: SubProps) {
  return (
    <svg viewBox="0 0 60 80" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <ellipse cx="30" cy="38" rx="17" ry="20" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      {/* hair */}
      <path d="M 12 28 Q 18 18 30 18 Q 42 18 48 28 Q 48 34 44 32 Q 30 26 16 32 Q 12 34 12 28 Z" fill="#1a1a1a" />
      <path d="M 13 32 Q 18 36 22 32 L 22 38 Q 16 38 13 35 Z" fill="#1a1a1a" />
      {/* glasses */}
      <circle cx="22" cy="40" r="4.5" fill="rgba(255,255,255,0.3)" stroke="#1a1a1a" strokeWidth="1.4" />
      <circle cx="38" cy="40" r="4.5" fill="rgba(255,255,255,0.3)" stroke="#1a1a1a" strokeWidth="1.4" />
      <line x1="26.5" y1="40" x2="33.5" y2="40" stroke="#1a1a1a" strokeWidth="1.4" />
      {/* eyes behind glasses */}
      <g {...lookProps}>
        <circle cx="22" cy="40" r="1.6" fill="#1a1a1a" {...eyeProps} />
        <circle cx="38" cy="40" r="1.6" fill="#1a1a1a" {...eyeProps} />
      </g>
      {/* glasses glint */}
      <circle cx="20.5" cy="38.5" r="0.8" fill="#fff" opacity="0.9" />
      <circle cx="36.5" cy="38.5" r="0.8" fill="#fff" opacity="0.9" />
      {/* slight smirk */}
      <path d="M 26 50 Q 30 52 34 50" stroke="#1a1a1a" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function KidHoodie({ eyeProps, lookProps }: SubProps) {
  return (
    <svg viewBox="0 0 60 80" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      {/* hoodie */}
      <path d="M 6 80 L 6 62 Q 6 46 30 38 Q 54 46 54 62 L 54 80 Z" fill="#4a7ec7" stroke="#1a1a1a" strokeWidth="1.2" />
      {/* drawstrings */}
      <path d="M 26 50 L 24 58" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M 34 50 L 36 58" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="24" cy="59" r="1" fill="#fff" />
      <circle cx="36" cy="59" r="1" fill="#fff" />
      {/* head */}
      <ellipse cx="30" cy="38" rx="16" ry="18" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      {/* hair */}
      <path d="M 14 30 Q 22 18 38 22 Q 46 26 46 32 Q 38 28 28 30 Q 18 31 14 30 Z" fill="#7a4a26" />
      {/* hood opening shadow */}
      <path d="M 11 42 Q 11 36 14 32 L 14 42 Z" fill="#3a6fb8" />
      <path d="M 49 42 Q 49 36 46 32 L 46 42 Z" fill="#3a6fb8" />
      {/* eyes */}
      <g {...lookProps}>
        <circle cx="23" cy="40" r="2" fill="#1a1a1a" {...eyeProps} />
        <circle cx="37" cy="40" r="2" fill="#1a1a1a" {...eyeProps} />
      </g>
      <circle cx="23.6" cy="39.5" r="0.6" fill="#fff" />
      <circle cx="37.6" cy="39.5" r="0.6" fill="#fff" />
      {/* subtle smile */}
      <path d="M 27 49 Q 30 51 33 49" stroke="#1a1a1a" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

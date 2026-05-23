"use client";
// ============================================================
//  Reusable peeking-kid components.
//
//  Exports:
//   - <Kid />              raw SVG of one kid (variants 0–28)
//   - <KidsBehind />       wraps any child element with N peeking
//                          kids positioned behind it. Each kid peeks
//                          at independent random intervals. If
//                          `kids[i].variant` is omitted, a random
//                          variant is chosen on mount (still
//                          hydration-safe).
//   - PERSONALITIES        per-variant tilt/height/blink ranges
//   - VARIANT_POOL         array of all available variant indices
//   - pickRandomVariants   helper to pick N distinct random variants
//
//  Used by PeekingChildren (landing-page age cards), login page,
//  and the landing-page "Ready to take the first step?" CTA.
// ============================================================

import { useEffect, useState } from "react";

// ── PERSONALITY RANGES ────────────────────────────────────────
// 29 entries. First 4 hand-tuned, rest cycle three archetypes
// (shy / bouncy / sleepy) with light variations.

function persona(i: number) {
  const archetypes = [
    { tiltRange: [-9, -2] as [number, number],  heightRange: [80, 105] as [number, number], blinks: true,  blinkDelay: "1.4s" },
    { tiltRange: [ 1,  8] as [number, number],  heightRange: [70,  95] as [number, number], blinks: false, blinkDelay: "0s"   },
    { tiltRange: [-5,  3] as [number, number],  heightRange: [95, 120] as [number, number], blinks: true,  blinkDelay: "3.2s" },
    { tiltRange: [ 3, 11] as [number, number],  heightRange: [85, 110] as [number, number], blinks: true,  blinkDelay: "5.7s" },
  ];
  return archetypes[i % archetypes.length];
}

export const PERSONALITIES = Array.from({ length: 29 }, (_, i) => {
  // shift blinkDelay by index so kids don't blink in lockstep
  const base = persona(i);
  return { ...base, blinkDelay: `${(0.4 + (i * 0.37) % 5).toFixed(2)}s` };
});

export const VARIANT_POOL: number[] = Array.from({ length: 29 }, (_, i) => i);

export function pickRandomVariants(count: number, exclude: number[] = []): number[] {
  const pool = VARIANT_POOL.filter((v) => !exclude.includes(v));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function randIn([min, max]: [number, number]): number {
  return min + Math.random() * (max - min);
}

interface PeekState { active: boolean; height: number; tilt: number; }
const IDLE_STATE: PeekState = { active: false, height: 0, tilt: 0 };

// ── KIDS-BEHIND WRAPPER ───────────────────────────────────────
//
// Places `kids` peeking behind whatever you wrap. Each kid is its
// own independently scheduled peeker.
//
// Children content MUST have an opaque background (z-index of the
// content stacks above the kids).

interface KidPosition {
  /** Optional explicit variant. If omitted, a random one is picked on mount. */
  variant?: number;
  /** CSS left value, e.g. "20%" or "100px" — relative to the wrapper */
  left: string;
  /** Optional kid size in px (default 56 wide / 88 tall) */
  size?: { width: number; height: number };
}

export function KidsBehind({
  kids, children, contentZIndex = 2,
}: {
  kids: KidPosition[];
  children: React.ReactNode;
  contentZIndex?: number;
}) {
  const [states, setStates] = useState<PeekState[]>(kids.map(() => IDLE_STATE));

  // Resolved variants: explicit (from props) or random (filled on mount).
  // Initial state mirrors what the server renders: explicit if provided,
  // otherwise variant 0. After mount, randomize any that were omitted so
  // hydration matches and the user still sees variety across loads.
  const [resolvedVariants, setResolvedVariants] = useState<number[]>(
    () => kids.map((k) => k.variant ?? 0)
  );

  useEffect(() => {
    const needsRandom = kids.some((k) => k.variant === undefined);
    if (needsRandom) {
      const explicit = kids.map((k) => k.variant).filter((v): v is number => v !== undefined);
      const picks = pickRandomVariants(kids.filter((k) => k.variant === undefined).length, explicit);
      let pickIdx = 0;
      setResolvedVariants(kids.map((k) => (k.variant !== undefined ? k.variant : picks[pickIdx++])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kids.length]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedulePeek = (i: number) => {
      const variant = resolvedVariants[i] ?? 0;
      const p = PERSONALITIES[variant] || PERSONALITIES[0];
      const initialDelay = 1500 + Math.random() * 5000;
      const cycle = () => {
        const height = randIn(p.heightRange);
        const tilt   = randIn(p.tiltRange);
        setStates((curr) => { const next = [...curr]; next[i] = { active: true, height, tilt }; return next; });
        const visibleFor = 2200 + Math.random() * 1500;
        timers.push(setTimeout(() => {
          setStates((curr) => { const next = [...curr]; next[i] = IDLE_STATE; return next; });
          const gap = 5000 + Math.random() * 8000;
          timers.push(setTimeout(cycle, gap));
        }, visibleFor));
      };
      timers.push(setTimeout(cycle, initialDelay));
    };
    kids.forEach((_, i) => schedulePeek(i));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedVariants]);

  return (
    <>
      <KidsKeyframes />
      <div style={{ position: "relative" }}>
        {kids.map((k, i) => {
          const variant = resolvedVariants[i] ?? 0;
          const p = PERSONALITIES[variant] || PERSONALITIES[0];
          const state = states[i] || IDLE_STATE;
          // Wrapper has paddingTop:100 above the opaque content box. Kid is
          // absolute top:0 (kid height 88). Card top is at y=100.
          //   Idle: translateY 118% → kid fully behind opaque card.
          //   Peek: translateY 15–50% → head + upper torso above the card;
          //         body always overlaps and is clipped by the card.
          const idleTransform = `translate(-50%, 118%) rotate(0deg)`;
          const peekTransform = `translate(-50%, ${(99 - 0.7 * state.height).toFixed(1)}%) rotate(${state.tilt.toFixed(1)}deg)`;
          const w = k.size?.width  ?? 56;
          const h = k.size?.height ?? 88;
          return (
            <div
              key={i}
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                left: k.left,
                width: w,
                height: h,
                transform: state.active ? peekTransform : idleTransform,
                transition: "transform 0.95s cubic-bezier(0.34, 1.5, 0.64, 1)",
                pointerEvents: "none",
                zIndex: 1,
                overflow: "hidden",
              }}
            >
              <Kid variant={variant} blinks={p.blinks} blinkDelay={p.blinkDelay} lookAround={variant % 7 === 2} />
            </div>
          );
        })}
        <div style={{ position: "relative", zIndex: contentZIndex, paddingTop: 100 }}>
          {children}
        </div>
      </div>
    </>
  );
}

// ── SHARED CSS KEYFRAMES ──────────────────────────────────────
function KidsKeyframes() {
  return (
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
  );
}

// ── KID SVG ────────────────────────────────────────────────────
interface KidProps {
  variant: number;
  blinks?: boolean;
  blinkDelay?: string;
  lookAround?: boolean;
}

export function Kid({ variant, blinks, blinkDelay, lookAround }: KidProps) {
  const eyeProps = blinks
    ? { className: "ra-eye-blink", style: { animationDelay: blinkDelay } as React.CSSProperties }
    : {};
  const lookProps = lookAround ? { className: "ra-look-around" } : {};
  const sp: SubProps = { eyeProps, lookProps };

  switch (variant) {
    case 0:  return <KidPigtails {...sp} />;
    case 1:  return <KidCap {...sp} />;
    case 2:  return <KidGlasses {...sp} />;
    case 3:  return <KidHoodie {...sp} />;
    case 4:  return <KidBraids {...sp} />;
    case 5:  return <KidBun {...sp} />;
    case 6:  return <KidAfro {...sp} />;
    case 7:  return <KidBeanie {...sp} />;
    case 8:  return <KidHijab {...sp} />;
    case 9:  return <KidShortBlond {...sp} />;
    case 10: return <KidLongStraight {...sp} />;
    case 11: return <KidBowtie {...sp} />;
    case 12: return <KidBowInHair {...sp} />;
    case 13: return <KidVisor {...sp} />;
    case 14: return <KidEarmuffs {...sp} />;
    case 15: return <KidPlaidShirt {...sp} />;
    case 16: return <KidBandana {...sp} />;
    case 17: return <KidHorizStripes {...sp} />;
    case 18: return <KidOveralls {...sp} />;
    case 19: return <KidTurtleneck {...sp} />;
    case 20: return <KidTankTop {...sp} />;
    case 21: return <KidSidePonytail {...sp} />;
    case 22: return <KidPompomHat {...sp} />;
    case 23: return <KidPigtailsBlack {...sp} />;
    case 24: return <KidCurlyTwins {...sp} />;
    case 25: return <KidTuque {...sp} />;
    case 26: return <KidGoggles {...sp} />;
    case 27: return <KidLongRed {...sp} />;
    case 28: return <KidMessyBangs {...sp} />;
    default: return <KidPigtails {...sp} />;
  }
}

type SubProps = { eyeProps: any; lookProps: any };

// ── SHARED BUILDING BLOCKS ───────────────────────────────────
// All SVGs use viewBox 0 0 60 100. y=0 is top of head area, y=100 bottom of shoulders.

function Shoulders({ color, pattern, accent }: { color: string; pattern?: "solid"|"striped"|"polka"|"plaid"; accent?: string }) {
  const ac = accent ?? "#fff";
  return (
    <>
      <path d="M 4 100 L 4 80 Q 6 66 30 60 Q 54 66 56 80 L 56 100 Z" fill={color} stroke="#1a1a1a" strokeWidth="1.2" />
      {pattern === "striped" && (
        <>
          <path d="M 4 84 L 56 84" stroke={ac} strokeWidth="2" opacity="0.7" />
          <path d="M 4 92 L 56 92" stroke={ac} strokeWidth="2" opacity="0.7" />
        </>
      )}
      {pattern === "polka" && (
        <>
          <circle cx="20" cy="78" r="1.4" fill={ac} />
          <circle cx="38" cy="84" r="1.4" fill={ac} />
          <circle cx="46" cy="78" r="1.4" fill={ac} />
          <circle cx="12" cy="88" r="1.4" fill={ac} />
        </>
      )}
      {pattern === "plaid" && (
        <>
          <path d="M 20 60 L 20 100" stroke={ac} strokeWidth="1.2" opacity="0.55" />
          <path d="M 40 60 L 40 100" stroke={ac} strokeWidth="1.2" opacity="0.55" />
          <path d="M 4 82 L 56 82" stroke={ac} strokeWidth="1.2" opacity="0.55" />
          <path d="M 4 94 L 56 94" stroke={ac} strokeWidth="1.2" opacity="0.55" />
        </>
      )}
    </>
  );
}

function Neck({ skin }: { skin: string }) {
  return <rect x="26" y="55" width="8" height="8" fill={skin} stroke="#1a1a1a" strokeWidth="1.2" />;
}

function Head({ skin, rx = 17, ry = 19 }: { skin: string; rx?: number; ry?: number }) {
  return <ellipse cx="30" cy="38" rx={rx} ry={ry} fill={skin} stroke="#1a1a1a" strokeWidth="1.2" />;
}

function Eyes({ eyeProps, lookProps, cy = 40, r = 2 }: SubProps & { cy?: number; r?: number }) {
  return (
    <>
      <g {...lookProps}>
        <circle cx="23" cy={cy} r={r} fill="#1a1a1a" {...eyeProps} />
        <circle cx="37" cy={cy} r={r} fill="#1a1a1a" {...eyeProps} />
      </g>
      <circle cx="23.6" cy={cy - 0.5} r="0.6" fill="#fff" />
      <circle cx="37.6" cy={cy - 0.5} r="0.6" fill="#fff" />
    </>
  );
}

function Mouth({ y = 50, kind = "smile" }: { y?: number; kind?: "smile"|"grin"|"open" }) {
  if (kind === "open") return <ellipse cx="30" cy={y} rx="2.4" ry="1.8" fill="#7a2a1a" stroke="#1a1a1a" strokeWidth="0.7" />;
  if (kind === "grin") return <path d={`M 24 ${y - 1} Q 30 ${y + 4} 36 ${y - 1} Z`} stroke="#1a1a1a" strokeWidth="1.2" strokeLinejoin="round" fill="#fff" />;
  return <path d={`M 26 ${y} Q 30 ${y + 3} 34 ${y}`} stroke="#1a1a1a" strokeWidth="1.4" strokeLinecap="round" fill="none" />;
}

function Cheeks({ color, op = 0.5, r = 2.2, cy = 45 }: { color: string; op?: number; r?: number; cy?: number }) {
  return (
    <>
      <circle cx="17" cy={cy} r={r} fill={color} opacity={op} />
      <circle cx="43" cy={cy} r={r} fill={color} opacity={op} />
    </>
  );
}

// ── ORIGINAL 4 (variants 0-3) ─────────────────────────────────

function KidPigtails({ eyeProps, lookProps }: SubProps) {
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#f4d050" pattern="polka" />
      <Neck skin="#fbe1c4" />
      <ellipse cx="10" cy="32" rx="8" ry="11" fill="#a86b3a" />
      <ellipse cx="50" cy="32" rx="8" ry="11" fill="#a86b3a" />
      <circle cx="10" cy="22" r="2.5" fill="#e8793a" />
      <circle cx="50" cy="22" r="2.5" fill="#e8793a" />
      <Head skin="#fbe1c4" rx={18} ry={20} />
      <path d="M 14 24 Q 30 12 46 24 Q 42 28 30 27 Q 18 28 14 24 Z" fill="#a86b3a" />
      <g {...lookProps}>
        <circle cx="22" cy="35" r="2.2" fill="#1a1a1a" {...eyeProps} />
        <circle cx="38" cy="35" r="2.2" fill="#1a1a1a" {...eyeProps} />
      </g>
      <circle cx="22.7" cy="34.3" r="0.7" fill="#fff" />
      <circle cx="38.7" cy="34.3" r="0.7" fill="#fff" />
      <Cheeks color="#f5a78a" op={0.55} r={2.5} cy={42} />
      <Mouth y={44} />
    </svg>
  );
}

function KidCap({ eyeProps, lookProps }: SubProps) {
  const skin = "#6e4423";
  const skinDark = "#4a2a14";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#4aa37e" pattern="striped" />
      <Neck skin={skin} />
      <Head skin={skin} rx={17} ry={19} />
      <path d="M 14 32 Q 30 28 46 32 L 46 38 Q 30 36 14 38 Z" fill="#1a0e04" />
      <path d="M 11 28 Q 30 12 49 28 L 49 30 L 11 30 Z" fill="#e8793a" stroke="#1a1a1a" strokeWidth="1.2" />
      <ellipse cx="30" cy="30" rx="22" ry="3" fill="#c45f20" stroke="#1a1a1a" strokeWidth="1.2" />
      <circle cx="30" cy="22" r="2.2" fill="#fff" opacity="0.7" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} cy={40} />
      <Cheeks color={skinDark} op={0.5} r={2.5} cy={44} />
      <Mouth y={50} />
      <path d="M 28 50.5 L 28 52.5 L 32 52.5 L 32 50.5 Z" fill="#fff" stroke="#1a1a1a" strokeWidth="0.6" />
    </svg>
  );
}

function KidGlasses({ eyeProps, lookProps }: SubProps) {
  const skin = "#f1cf9a";
  const cheek = "#e89870";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#c9beac" />
      <path d="M 22 62 L 30 72 L 38 62" fill="#fff" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 30 72 L 30 80" stroke="#1a1a1a" strokeWidth="0.6" />
      <Neck skin={skin} />
      <Head skin={skin} rx={17} ry={20} />
      <path d="M 12 28 Q 18 18 30 18 Q 42 18 48 28 Q 48 34 44 32 Q 30 26 16 32 Q 12 34 12 28 Z" fill="#0a0a0a" />
      <path d="M 13 32 Q 18 36 22 32 L 22 38 Q 16 38 13 35 Z" fill="#0a0a0a" />
      <circle cx="22" cy="40" r="4.5" fill="rgba(255,255,255,0.3)" stroke="#1a1a1a" strokeWidth="1.4" />
      <circle cx="38" cy="40" r="4.5" fill="rgba(255,255,255,0.3)" stroke="#1a1a1a" strokeWidth="1.4" />
      <line x1="26.5" y1="40" x2="33.5" y2="40" stroke="#1a1a1a" strokeWidth="1.4" />
      <g {...lookProps}>
        <circle cx="22" cy="40" r="1.6" fill="#1a1a1a" {...eyeProps} />
        <circle cx="38" cy="40" r="1.6" fill="#1a1a1a" {...eyeProps} />
      </g>
      <circle cx="20.5" cy="38.5" r="0.8" fill="#fff" opacity="0.9" />
      <circle cx="36.5" cy="38.5" r="0.8" fill="#fff" opacity="0.9" />
      <Cheeks color={cheek} op={0.5} r={2.2} cy={47} />
      <Mouth y={51} />
    </svg>
  );
}

function KidHoodie({ eyeProps, lookProps }: SubProps) {
  const skin = "#b07a4a";
  const cheek = "#8a4a24";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <path d="M 4 100 L 4 62 Q 4 46 30 38 Q 56 46 56 62 L 56 100 Z" fill="#4a7ec7" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 18 78 Q 30 84 42 78 L 42 90 Q 30 92 18 90 Z" fill="#3a6fb8" stroke="#1a1a1a" strokeWidth="0.8" />
      <path d="M 26 50 L 24 60" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M 34 50 L 36 60" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="24" cy="61" r="1" fill="#fff" />
      <circle cx="36" cy="61" r="1" fill="#fff" />
      <Head skin={skin} rx={16} ry={18} />
      <path d="M 14 30 Q 22 18 38 22 Q 46 26 46 32 Q 38 28 28 30 Q 18 31 14 30 Z" fill="#1a0f08" />
      <path d="M 11 42 Q 11 36 14 32 L 14 42 Z" fill="#3a6fb8" />
      <path d="M 49 42 Q 49 36 46 32 L 46 42 Z" fill="#3a6fb8" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} cy={40} />
      <Cheeks color={cheek} op={0.45} r={2.2} cy={46} />
      <Mouth y={49} />
    </svg>
  );
}

// ── 25 NEW VARIANTS (4-28) ────────────────────────────────────

// 4. Braids — Black girl with two long braids
function KidBraids({ eyeProps, lookProps }: SubProps) {
  const skin = "#7a4a24";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#c75046" />
      <Neck skin={skin} />
      {/* braids hanging down */}
      <path d="M 8 30 Q 6 50 8 78" stroke="#1a0e04" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M 52 30 Q 54 50 52 78" stroke="#1a0e04" strokeWidth="6" fill="none" strokeLinecap="round" />
      <circle cx="8" cy="80" r="2" fill="#e8a843" />
      <circle cx="52" cy="80" r="2" fill="#e8a843" />
      <Head skin={skin} />
      <path d="M 12 28 Q 30 14 48 28 Q 48 36 44 34 Q 30 28 16 34 Q 12 34 12 28 Z" fill="#1a0e04" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#5a2e10" op={0.5} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 5. Bun — Asian girl with top knot
function KidBun({ eyeProps, lookProps }: SubProps) {
  const skin = "#f1cf9a";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#3aa8a3" />
      <path d="M 22 62 L 38 62 L 38 70 L 22 70 Z" fill="#fff" stroke="#1a1a1a" strokeWidth="1" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <circle cx="30" cy="14" r="6" fill="#0a0a0a" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 14 30 Q 30 16 46 30 Q 42 36 30 36 Q 18 36 14 30 Z" fill="#0a0a0a" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} r={1.7} />
      <Cheeks color="#e89870" op={0.45} cy={47} />
      <Mouth y={50} />
    </svg>
  );
}

// 6. Afro — Black kid with round afro
function KidAfro({ eyeProps, lookProps }: SubProps) {
  const skin = "#6e4423";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#f4d050" />
      <Neck skin={skin} />
      {/* afro halo */}
      <circle cx="30" cy="28" r="22" fill="#1a0e04" />
      <circle cx="14" cy="30" r="5" fill="#1a0e04" />
      <circle cx="46" cy="30" r="5" fill="#1a0e04" />
      <circle cx="20" cy="14" r="4" fill="#1a0e04" />
      <circle cx="40" cy="14" r="4" fill="#1a0e04" />
      <Head skin={skin} />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#4a2a14" op={0.5} cy={46} />
      <Mouth y={50} kind="grin" />
    </svg>
  );
}

// 7. Beanie — white kid with knit beanie + plaid shirt + freckles
function KidBeanie({ eyeProps, lookProps }: SubProps) {
  const skin = "#fbe1c4";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#a83a32" pattern="plaid" accent="#ffd47a" />
      <Neck skin={skin} />
      <Head skin={skin} />
      {/* beanie */}
      <path d="M 10 30 Q 10 14 30 12 Q 50 14 50 30 L 10 30 Z" fill="#3a6fb8" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 10 30 L 50 30 L 50 34 L 10 34 Z" fill="#2a5a98" stroke="#1a1a1a" strokeWidth="0.8" />
      <circle cx="30" cy="10" r="2.2" fill="#fff" opacity="0.8" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      {/* freckles */}
      <circle cx="22" cy="44" r="0.6" fill="#a86b3a" />
      <circle cx="26" cy="46" r="0.6" fill="#a86b3a" />
      <circle cx="34" cy="46" r="0.6" fill="#a86b3a" />
      <circle cx="38" cy="44" r="0.6" fill="#a86b3a" />
      <Mouth y={50} />
    </svg>
  );
}

// 8. Hijab — brown girl with headscarf
function KidHijab({ eyeProps, lookProps }: SubProps) {
  const skin = "#c08a5a";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#7a4ea8" />
      <Neck skin={skin} />
      {/* hijab — scarf around face */}
      <path d="M 4 80 L 6 50 Q 12 18 30 14 Q 48 18 54 50 L 56 80" fill="#6e3a98" stroke="#1a1a1a" strokeWidth="1.2" />
      <ellipse cx="30" cy="42" rx="14" ry="18" fill={skin} stroke="#1a1a1a" strokeWidth="1.2" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} cy={42} r={1.9} />
      <Cheeks color="#8a5a30" op={0.4} cy={50} />
      <Mouth y={54} />
    </svg>
  );
}

// 9. Short blond — white boy short blond hair
function KidShortBlond({ eyeProps, lookProps }: SubProps) {
  const skin = "#fbe1c4";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#4aa37e" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 12 30 Q 18 16 30 16 Q 42 16 48 30 Q 44 26 38 27 Q 30 24 22 27 Q 16 26 12 30 Z" fill="#e8c878" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#f5a78a" op={0.5} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 10. Long straight — Asian girl with long straight black hair
function KidLongStraight({ eyeProps, lookProps }: SubProps) {
  const skin = "#f1cf9a";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#e89bbd" />
      <Neck skin={skin} />
      {/* long hair behind */}
      <path d="M 6 95 Q 4 50 12 28 Q 30 14 48 28 Q 56 50 54 95 L 46 95 Q 48 60 42 38 Q 30 30 18 38 Q 12 60 14 95 Z" fill="#0a0a0a" stroke="#1a1a1a" strokeWidth="1" />
      <Head skin={skin} />
      <path d="M 12 28 Q 30 14 48 28 L 48 36 Q 30 30 12 36 Z" fill="#0a0a0a" />
      <path d="M 22 28 L 18 40" stroke="#0a0a0a" strokeWidth="3" strokeLinecap="round" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} r={1.7} />
      <Cheeks color="#e89870" op={0.45} cy={47} />
      <Mouth y={50} />
    </svg>
  );
}

// 11. Bowtie — Black boy with bowtie + button-up shirt
function KidBowtie({ eyeProps, lookProps }: SubProps) {
  const skin = "#6e4423";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#ffffff" />
      <path d="M 24 64 L 36 64 L 36 78 L 24 78 Z" fill="#ffffff" stroke="#1a1a1a" strokeWidth="0.8" />
      {/* bowtie */}
      <path d="M 22 62 L 28 65 L 28 68 L 22 71 Z" fill="#c75046" stroke="#1a1a1a" strokeWidth="1" />
      <path d="M 38 62 L 32 65 L 32 68 L 38 71 Z" fill="#c75046" stroke="#1a1a1a" strokeWidth="1" />
      <rect x="28" y="64" width="4" height="5" fill="#a83a30" stroke="#1a1a1a" strokeWidth="0.6" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 12 28 Q 30 18 48 28 L 48 34 Q 30 32 12 34 Z" fill="#1a0e04" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#4a2a14" op={0.5} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 12. Bow in hair — Mediterranean girl pigtails with bow
function KidBowInHair({ eyeProps, lookProps }: SubProps) {
  const skin = "#e8b889";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#bca8d4" />
      <Neck skin={skin} />
      <ellipse cx="12" cy="34" rx="6" ry="10" fill="#3a2410" />
      <ellipse cx="48" cy="34" rx="6" ry="10" fill="#3a2410" />
      <Head skin={skin} />
      <path d="M 14 26 Q 30 14 46 26 Q 42 30 30 30 Q 18 30 14 26 Z" fill="#3a2410" />
      {/* big bow on top */}
      <path d="M 22 18 L 30 22 L 22 26 Z" fill="#e8a8c8" stroke="#1a1a1a" strokeWidth="0.8" />
      <path d="M 38 18 L 30 22 L 38 26 Z" fill="#e8a8c8" stroke="#1a1a1a" strokeWidth="0.8" />
      <circle cx="30" cy="22" r="2" fill="#c87a9a" stroke="#1a1a1a" strokeWidth="0.6" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#d48a6a" op={0.5} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 13. Visor — Hispanic kid with sun visor
function KidVisor({ eyeProps, lookProps }: SubProps) {
  const skin = "#d4986a";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#e88a4a" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 14 28 Q 30 20 46 28 L 46 32 Q 30 30 14 32 Z" fill="#3a2410" />
      {/* visor */}
      <path d="M 8 26 Q 30 18 52 26 L 52 30 L 8 30 Z" fill="#f4d050" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 14 24 L 46 24" stroke="#1a1a1a" strokeWidth="0.6" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#b07050" op={0.45} cy={46} />
      <Mouth y={50} kind="grin" />
    </svg>
  );
}

// 14. Earmuffs — white kid with fuzzy earmuffs
function KidEarmuffs({ eyeProps, lookProps }: SubProps) {
  const skin = "#fbe1c4";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#888c92" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 14 28 Q 30 18 46 28 L 46 36 Q 30 32 14 36 Z" fill="#a86b3a" />
      {/* earmuffs band */}
      <path d="M 10 22 Q 30 14 50 22" stroke="#1a1a1a" strokeWidth="1.6" fill="none" />
      <circle cx="8" cy="34" r="6" fill="#e8a8c8" stroke="#1a1a1a" strokeWidth="1" />
      <circle cx="52" cy="34" r="6" fill="#e8a8c8" stroke="#1a1a1a" strokeWidth="1" />
      <circle cx="8" cy="32" r="2" fill="#fff" opacity="0.6" />
      <circle cx="52" cy="32" r="2" fill="#fff" opacity="0.6" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#f59070" op={0.55} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 15. Plaid shirt — Indigenous kid with plaid lumberjack shirt
function KidPlaidShirt({ eyeProps, lookProps }: SubProps) {
  const skin = "#b07a4a";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#7a3a30" pattern="plaid" accent="#f4d050" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 12 28 Q 30 14 48 28 L 48 38 Q 30 32 12 38 Z" fill="#1a0e04" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#8a4a24" op={0.45} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 16. Bandana — brown girl with red bandana
function KidBandana({ eyeProps, lookProps }: SubProps) {
  const skin = "#8a5a30";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#ffffff" />
      <Neck skin={skin} />
      <Head skin={skin} />
      {/* bandana */}
      <path d="M 12 26 Q 30 20 48 26 L 48 32 Q 30 28 12 32 Z" fill="#c75046" stroke="#1a1a1a" strokeWidth="1" />
      <circle cx="20" cy="28" r="0.8" fill="#fff" />
      <circle cx="30" cy="26" r="0.8" fill="#fff" />
      <circle cx="40" cy="28" r="0.8" fill="#fff" />
      <path d="M 12 28 L 8 36 L 12 34 Z" fill="#c75046" stroke="#1a1a1a" strokeWidth="0.8" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#5a3010" op={0.5} cy={46} />
      <Mouth y={50} kind="grin" />
    </svg>
  );
}

// 17. Horizontal stripes — white kid with sailor-stripe shirt
function KidHorizStripes({ eyeProps, lookProps }: SubProps) {
  const skin = "#fbe1c4";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <path d="M 4 100 L 4 80 Q 6 66 30 60 Q 54 66 56 80 L 56 100 Z" fill="#ffffff" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 4 70 L 56 70" stroke="#1a3a78" strokeWidth="3" />
      <path d="M 4 78 L 56 78" stroke="#1a3a78" strokeWidth="3" />
      <path d="M 4 86 L 56 86" stroke="#1a3a78" strokeWidth="3" />
      <path d="M 4 94 L 56 94" stroke="#1a3a78" strokeWidth="3" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 12 28 Q 30 16 48 28 L 48 36 Q 38 30 30 30 Q 22 30 12 36 Z" fill="#c47030" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      {/* freckles */}
      <circle cx="22" cy="44" r="0.6" fill="#a83a30" />
      <circle cx="38" cy="44" r="0.6" fill="#a83a30" />
      <circle cx="30" cy="46" r="0.6" fill="#a83a30" />
      <Mouth y={50} />
    </svg>
  );
}

// 18. Overalls — Mediterranean kid with denim overalls
function KidOveralls({ eyeProps, lookProps }: SubProps) {
  const skin = "#e8b889";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#c75046" />
      {/* overall straps over shoulders */}
      <path d="M 16 68 L 20 100" stroke="#3a5a8a" strokeWidth="6" />
      <path d="M 44 68 L 40 100" stroke="#3a5a8a" strokeWidth="6" />
      <path d="M 16 82 L 44 82" stroke="#3a5a8a" strokeWidth="14" />
      <rect x="25" y="83" width="10" height="6" fill="#5a8ac4" stroke="#1a1a1a" strokeWidth="0.6" />
      <circle cx="17" cy="74" r="1" fill="#e8a843" />
      <circle cx="43" cy="74" r="1" fill="#e8a843" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 12 28 Q 30 14 48 28 L 48 36 Q 30 30 12 36 Z" fill="#5a3a20" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#d48a6a" op={0.5} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 19. Turtleneck — Asian boy in turtleneck
function KidTurtleneck({ eyeProps, lookProps }: SubProps) {
  const skin = "#f1cf9a";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#2a6a4a" />
      <path d="M 22 58 L 38 58 L 40 66 L 20 66 Z" fill="#3a8a5a" stroke="#1a1a1a" strokeWidth="0.8" />
      <Head skin={skin} />
      <path d="M 12 28 Q 30 14 48 28 L 48 34 Q 30 28 12 34 Z" fill="#0a0a0a" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} r={1.7} />
      <Cheeks color="#e89870" op={0.45} cy={47} />
      <Mouth y={50} />
    </svg>
  );
}

// 20. Tank top — Black boy with yellow tank top
function KidTankTop({ eyeProps, lookProps }: SubProps) {
  const skin = "#6e4423";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <path d="M 4 100 L 4 84 Q 12 70 22 68 L 22 100 Z" fill={skin} stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 56 100 L 56 84 Q 48 70 38 68 L 38 100 Z" fill={skin} stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 22 68 L 22 100 L 38 100 L 38 68 Q 30 64 22 68 Z" fill="#f4d050" stroke="#1a1a1a" strokeWidth="1.2" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 14 28 Q 30 22 46 28 L 46 32 Q 30 30 14 32 Z" fill="#1a0e04" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#4a2a14" op={0.5} cy={46} />
      <Mouth y={50} kind="grin" />
    </svg>
  );
}

// 21. Side ponytail — Hispanic girl with side ponytail
function KidSidePonytail({ eyeProps, lookProps }: SubProps) {
  const skin = "#d4986a";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#e89bbd" />
      <Neck skin={skin} />
      {/* ponytail to right side */}
      <path d="M 46 28 Q 56 32 58 50 Q 56 62 50 70 L 48 62 Q 52 50 50 38 Q 48 30 46 28 Z" fill="#3a2410" stroke="#1a1a1a" strokeWidth="1" />
      <Head skin={skin} />
      <path d="M 12 28 Q 24 14 40 22 Q 48 26 48 32 Q 36 30 26 30 Q 16 30 12 28 Z" fill="#3a2410" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#b07050" op={0.5} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 22. Pompom hat — white kid with pompom winter hat
function KidPompomHat({ eyeProps, lookProps }: SubProps) {
  const skin = "#fbe1c4";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#4a7ec7" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 10 30 Q 10 18 30 14 Q 50 18 50 30 L 10 30 Z" fill="#c75046" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 10 30 L 50 30 L 50 34 L 10 34 Z" fill="#ffffff" stroke="#1a1a1a" strokeWidth="0.8" />
      <circle cx="30" cy="10" r="4" fill="#ffffff" stroke="#1a1a1a" strokeWidth="1" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#f59070" op={0.6} cy={46} r={2.6} />
      <Mouth y={50} />
    </svg>
  );
}

// 23. Pigtails on Black kid — orange shirt
function KidPigtailsBlack({ eyeProps, lookProps }: SubProps) {
  const skin = "#6e4423";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#e88a4a" pattern="polka" />
      <Neck skin={skin} />
      <ellipse cx="10" cy="32" rx="8" ry="11" fill="#1a0e04" />
      <ellipse cx="50" cy="32" rx="8" ry="11" fill="#1a0e04" />
      <circle cx="10" cy="22" r="2.5" fill="#e8a843" />
      <circle cx="50" cy="22" r="2.5" fill="#e8a843" />
      <Head skin={skin} rx={18} ry={20} />
      <path d="M 14 24 Q 30 12 46 24 Q 42 28 30 27 Q 18 28 14 24 Z" fill="#1a0e04" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} cy={35} r={2.2} />
      <Cheeks color="#4a2a14" op={0.5} cy={42} />
      <Mouth y={44} />
    </svg>
  );
}

// 24. Curly twin puffs — Black girl with two curly puffs
function KidCurlyTwins({ eyeProps, lookProps }: SubProps) {
  const skin = "#6e4423";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#9876c7" />
      <Neck skin={skin} />
      {/* curly twin puffs */}
      <circle cx="14" cy="18" r="7" fill="#1a0e04" />
      <circle cx="46" cy="18" r="7" fill="#1a0e04" />
      <circle cx="10" cy="14" r="3" fill="#1a0e04" />
      <circle cx="18" cy="14" r="3" fill="#1a0e04" />
      <circle cx="42" cy="14" r="3" fill="#1a0e04" />
      <circle cx="50" cy="14" r="3" fill="#1a0e04" />
      <Head skin={skin} />
      <path d="M 14 26 Q 30 18 46 26 L 46 32 Q 30 28 14 32 Z" fill="#1a0e04" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#4a2a14" op={0.5} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 25. Tuque — Indigenous kid with Canadian tuque + plaid
function KidTuque({ eyeProps, lookProps }: SubProps) {
  const skin = "#b07a4a";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#7a3a30" pattern="plaid" accent="#f4d050" />
      <Neck skin={skin} />
      <Head skin={skin} />
      {/* tuque slouchy */}
      <path d="M 10 30 Q 12 8 32 8 Q 52 12 50 30 L 10 30 Z" fill="#2a5a8a" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 10 30 L 50 30 L 50 34 L 10 34 Z" fill="#3a6fb8" stroke="#1a1a1a" strokeWidth="0.8" />
      <path d="M 30 8 L 36 4" stroke="#1a1a1a" strokeWidth="0.8" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      <Cheeks color="#8a4a24" op={0.5} cy={46} />
      <Mouth y={50} />
    </svg>
  );
}

// 26. Ski goggles — white kid in winter cap + goggles
function KidGoggles({ eyeProps, lookProps }: SubProps) {
  const skin = "#fbe1c4";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#3a6fb8" />
      <path d="M 22 62 L 38 62 L 38 76 L 22 76 Z" fill="#3a6fb8" stroke="#1a1a1a" strokeWidth="0.8" />
      <Neck skin={skin} />
      <Head skin={skin} />
      <path d="M 10 30 Q 10 14 30 12 Q 50 14 50 30 L 10 30 Z" fill="#c75046" stroke="#1a1a1a" strokeWidth="1.2" />
      {/* goggles band */}
      <path d="M 8 38 L 52 38" stroke="#1a1a1a" strokeWidth="2" />
      <path d="M 13 34 Q 21 32 26 36 L 26 42 Q 18 44 13 42 Z" fill="#3aa8a3" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 47 34 Q 39 32 34 36 L 34 42 Q 42 44 47 42 Z" fill="#3aa8a3" stroke="#1a1a1a" strokeWidth="1.2" />
      <circle cx="19" cy="38" r="1.5" fill="#fff" opacity="0.7" />
      <circle cx="41" cy="38" r="1.5" fill="#fff" opacity="0.7" />
      <Cheeks color="#f59070" op={0.6} cy={48} />
      <Mouth y={50} />
    </svg>
  );
}

// 27. Long red — white girl with long red wavy hair
function KidLongRed({ eyeProps, lookProps }: SubProps) {
  const skin = "#fbe1c4";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#f4d050" />
      <Neck skin={skin} />
      {/* long wavy hair behind shoulders */}
      <path d="M 4 95 Q 2 56 12 30 Q 30 14 48 30 Q 58 56 56 95 L 48 95 Q 50 62 44 40 Q 30 30 16 40 Q 10 62 12 95 Z" fill="#c47030" stroke="#1a1a1a" strokeWidth="0.8" />
      <Head skin={skin} />
      <path d="M 12 28 Q 30 14 48 28 Q 44 36 30 32 Q 16 36 12 28 Z" fill="#c47030" />
      {/* fringe wisps */}
      <path d="M 18 28 L 16 36" stroke="#c47030" strokeWidth="2" strokeLinecap="round" />
      <path d="M 42 28 L 44 36" stroke="#c47030" strokeWidth="2" strokeLinecap="round" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} />
      {/* freckles */}
      <circle cx="22" cy="44" r="0.6" fill="#a83a30" />
      <circle cx="26" cy="46" r="0.6" fill="#a83a30" />
      <circle cx="34" cy="46" r="0.6" fill="#a83a30" />
      <circle cx="38" cy="44" r="0.6" fill="#a83a30" />
      <Mouth y={50} />
    </svg>
  );
}

// 28. Messy bangs — Mediterranean kid with messy hair and bangs
function KidMessyBangs({ eyeProps, lookProps }: SubProps) {
  const skin = "#e8b889";
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <Shoulders color="#3aa8a3" pattern="striped" accent="#fff" />
      <Neck skin={skin} />
      <Head skin={skin} />
      {/* messy hair with bangs hanging over eyes */}
      <path d="M 10 30 Q 14 14 30 12 Q 46 14 50 30 Q 46 22 40 24 Q 30 18 20 24 Q 14 22 10 30 Z" fill="#3a2410" />
      <path d="M 14 28 Q 22 30 26 38 L 22 38 Z" fill="#3a2410" />
      <path d="M 46 28 Q 38 30 34 38 L 38 38 Z" fill="#3a2410" />
      <path d="M 16 32 L 14 42" stroke="#3a2410" strokeWidth="2" strokeLinecap="round" />
      <path d="M 44 32 L 46 42" stroke="#3a2410" strokeWidth="2" strokeLinecap="round" />
      <Eyes eyeProps={eyeProps} lookProps={lookProps} cy={42} />
      <Cheeks color="#d48a6a" op={0.5} cy={48} />
      <Mouth y={52} />
    </svg>
  );
}

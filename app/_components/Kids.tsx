"use client";
// ============================================================
//  Reusable peeking-kid components.
//
//  Exports:
//   - <Kid />              raw SVG of one kid (4 variants)
//   - <KidsBehind />       wraps any child element with N peeking
//                          kids positioned behind it. Each kid peeks
//                          at independent random intervals.
//
//  Used by PeekingChildren (landing-page age cards), login page,
//  and the landing-page "Ready to take the first step?" CTA.
// ============================================================

import { useEffect, useState } from "react";

// ── PERSONALITY RANGES ────────────────────────────────────────
export const PERSONALITIES = [
  { tiltRange: [-9, -2] as [number, number],  heightRange: [80, 105] as [number, number], blinks: true,  blinkDelay: "1.4s" },
  { tiltRange: [ 1,  8] as [number, number],  heightRange: [70,  95] as [number, number], blinks: false, blinkDelay: "0s"   },
  { tiltRange: [-5,  3] as [number, number],  heightRange: [95, 120] as [number, number], blinks: true,  blinkDelay: "3.2s" },
  { tiltRange: [ 3, 11] as [number, number],  heightRange: [85, 110] as [number, number], blinks: true,  blinkDelay: "5.7s" },
];

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
  variant: 0 | 1 | 2 | 3;
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

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedulePeek = (i: number) => {
      const p = PERSONALITIES[kids[i].variant] || PERSONALITIES[0];
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
  }, [kids.length]);

  return (
    <>
      <KidsKeyframes />
      <div style={{ position: "relative" }}>
        {kids.map((k, i) => {
          const p = PERSONALITIES[k.variant] || PERSONALITIES[0];
          const state = states[i] || IDLE_STATE;
          // Idle: fully pushed below container top → covered by card body.
          // Peek: head + shoulders pop above.
          const idleTransform = `translate(-50%, 100%) rotate(0deg)`;
          const peekTransform = `translate(-50%, -${state.height.toFixed(1)}%) rotate(${state.tilt.toFixed(1)}deg)`;
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
                overflow: "hidden",   /* clamp body so it can't bleed out the bottom */
              }}
            >
              <Kid variant={k.variant} blinks={p.blinks} blinkDelay={p.blinkDelay} lookAround={k.variant === 2} />
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
    <svg viewBox="0 0 60 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <path d="M 4 100 L 4 80 Q 6 66 30 60 Q 54 66 56 80 L 56 100 Z" fill="#f4d050" stroke="#1a1a1a" strokeWidth="1.2" />
      <circle cx="20" cy="78" r="1.4" fill="#fff" />
      <circle cx="38" cy="84" r="1.4" fill="#fff" />
      <circle cx="46" cy="78" r="1.4" fill="#fff" />
      <circle cx="12" cy="88" r="1.4" fill="#fff" />
      <rect x="26" y="54" width="8" height="8" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      <ellipse cx="10" cy="32" rx="8" ry="11" fill="#a86b3a" />
      <ellipse cx="50" cy="32" rx="8" ry="11" fill="#a86b3a" />
      <circle cx="10" cy="22" r="2.5" fill="#e8793a" />
      <circle cx="50" cy="22" r="2.5" fill="#e8793a" />
      <ellipse cx="30" cy="35" rx="18" ry="20" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 14 24 Q 30 12 46 24 Q 42 28 30 27 Q 18 28 14 24 Z" fill="#a86b3a" />
      <g {...lookProps}>
        <circle cx="22" cy="35" r="2.2" fill="#1a1a1a" {...eyeProps} />
        <circle cx="38" cy="35" r="2.2" fill="#1a1a1a" {...eyeProps} />
      </g>
      <circle cx="22.7" cy="34.3" r="0.7" fill="#fff" />
      <circle cx="38.7" cy="34.3" r="0.7" fill="#fff" />
      <circle cx="17" cy="42" r="2.5" fill="#f5a78a" opacity="0.55" />
      <circle cx="43" cy="42" r="2.5" fill="#f5a78a" opacity="0.55" />
      <path d="M 25 44 Q 30 48 35 44" stroke="#1a1a1a" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function KidCap({ eyeProps, lookProps }: SubProps) {
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <path d="M 4 100 L 4 80 Q 6 66 30 60 Q 54 66 56 80 L 56 100 Z" fill="#4aa37e" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 4 84 L 56 84" stroke="#fff" strokeWidth="2" opacity="0.7" />
      <path d="M 4 92 L 56 92" stroke="#fff" strokeWidth="2" opacity="0.7" />
      <rect x="26" y="55" width="8" height="8" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      <ellipse cx="30" cy="38" rx="17" ry="19" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 14 32 Q 30 28 46 32 L 46 38 Q 30 36 14 38 Z" fill="#3a2618" />
      <path d="M 11 28 Q 30 12 49 28 L 49 30 L 11 30 Z" fill="#e8793a" stroke="#1a1a1a" strokeWidth="1.2" />
      <ellipse cx="30" cy="30" rx="22" ry="3" fill="#c45f20" stroke="#1a1a1a" strokeWidth="1.2" />
      <circle cx="30" cy="22" r="2.2" fill="#fff" opacity="0.7" />
      <g {...lookProps}>
        <circle cx="23" cy="40" r="2" fill="#1a1a1a" {...eyeProps} />
        <circle cx="37" cy="40" r="2" fill="#1a1a1a" {...eyeProps} />
      </g>
      <circle cx="23.6" cy="39.5" r="0.6" fill="#fff" />
      <circle cx="37.6" cy="39.5" r="0.6" fill="#fff" />
      <circle cx="20" cy="44" r="0.6" fill="#a86b3a" />
      <circle cx="24" cy="46" r="0.6" fill="#a86b3a" />
      <circle cx="36" cy="46" r="0.6" fill="#a86b3a" />
      <circle cx="40" cy="44" r="0.6" fill="#a86b3a" />
      <path d="M 26 50 Q 30 54 34 50" stroke="#1a1a1a" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M 28 50.5 L 28 52.5 L 32 52.5 L 32 50.5 Z" fill="#fff" stroke="#1a1a1a" strokeWidth="0.6" />
    </svg>
  );
}

function KidGlasses({ eyeProps, lookProps }: SubProps) {
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <path d="M 4 100 L 4 80 Q 6 66 30 60 Q 54 66 56 80 L 56 100 Z" fill="#c9beac" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 22 62 L 30 72 L 38 62" fill="#fff" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 30 72 L 30 80" stroke="#1a1a1a" strokeWidth="0.6" />
      <rect x="26" y="55" width="8" height="8" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      <ellipse cx="30" cy="38" rx="17" ry="20" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 12 28 Q 18 18 30 18 Q 42 18 48 28 Q 48 34 44 32 Q 30 26 16 32 Q 12 34 12 28 Z" fill="#1a1a1a" />
      <path d="M 13 32 Q 18 36 22 32 L 22 38 Q 16 38 13 35 Z" fill="#1a1a1a" />
      <circle cx="22" cy="40" r="4.5" fill="rgba(255,255,255,0.3)" stroke="#1a1a1a" strokeWidth="1.4" />
      <circle cx="38" cy="40" r="4.5" fill="rgba(255,255,255,0.3)" stroke="#1a1a1a" strokeWidth="1.4" />
      <line x1="26.5" y1="40" x2="33.5" y2="40" stroke="#1a1a1a" strokeWidth="1.4" />
      <g {...lookProps}>
        <circle cx="22" cy="40" r="1.6" fill="#1a1a1a" {...eyeProps} />
        <circle cx="38" cy="40" r="1.6" fill="#1a1a1a" {...eyeProps} />
      </g>
      <circle cx="20.5" cy="38.5" r="0.8" fill="#fff" opacity="0.9" />
      <circle cx="36.5" cy="38.5" r="0.8" fill="#fff" opacity="0.9" />
      <path d="M 26 50 Q 30 52 34 50" stroke="#1a1a1a" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function KidHoodie({ eyeProps, lookProps }: SubProps) {
  return (
    <svg viewBox="0 0 60 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
      <path d="M 4 100 L 4 62 Q 4 46 30 38 Q 56 46 56 62 L 56 100 Z" fill="#4a7ec7" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 18 78 Q 30 84 42 78 L 42 90 Q 30 92 18 90 Z" fill="#3a6fb8" stroke="#1a1a1a" strokeWidth="0.8" />
      <path d="M 26 50 L 24 60" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M 34 50 L 36 60" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="24" cy="61" r="1" fill="#fff" />
      <circle cx="36" cy="61" r="1" fill="#fff" />
      <ellipse cx="30" cy="38" rx="16" ry="18" fill="#fbe1c4" stroke="#1a1a1a" strokeWidth="1.2" />
      <path d="M 14 30 Q 22 18 38 22 Q 46 26 46 32 Q 38 28 28 30 Q 18 31 14 30 Z" fill="#7a4a26" />
      <path d="M 11 42 Q 11 36 14 32 L 14 42 Z" fill="#3a6fb8" />
      <path d="M 49 42 Q 49 36 46 32 L 46 42 Z" fill="#3a6fb8" />
      <g {...lookProps}>
        <circle cx="23" cy="40" r="2" fill="#1a1a1a" {...eyeProps} />
        <circle cx="37" cy="40" r="2" fill="#1a1a1a" {...eyeProps} />
      </g>
      <circle cx="23.6" cy="39.5" r="0.6" fill="#fff" />
      <circle cx="37.6" cy="39.5" r="0.6" fill="#fff" />
      <path d="M 27 49 Q 30 51 33 49" stroke="#1a1a1a" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

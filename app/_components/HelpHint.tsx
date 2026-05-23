"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Inline help icon (?) that opens a small popover with a description
 * and optional example list. Shared between admin + portal.
 *
 * Usage:
 *   <HelpHint title="Reimbursable amount" body="..." examples={["..."]} />
 */

interface Props {
  /** Optional bold heading at top of popover. */
  title?: string;
  /** Main explanation. Plain text only. */
  body: string;
  /** Optional list of concrete examples shown under a divider. */
  examples?: string[];
  /** Color of the (?) ring. Default = current text color. */
  tone?: "light" | "dark";
}

export function HelpHint({ title, body, examples, tone }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ringColor = tone === "light" ? "rgba(255,255,255,0.55)" : "#888";

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", marginLeft: 6, verticalAlign: "middle" }}>
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((o) => !o); }}
        aria-label="What is this?"
        aria-expanded={open}
        type="button"
        style={{
          width: 18, height: 18, borderRadius: "50%",
          border: `1px solid ${ringColor}`, color: ringColor,
          background: "transparent", cursor: "pointer",
          fontSize: 11, fontWeight: 700,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          padding: 0, lineHeight: 1,
          fontFamily: "var(--font-body)",
        }}
      >
        ?
      </button>
      {open && (
        <div
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", top: "calc(100% + 8px)", left: 0,
            minWidth: 240, maxWidth: 340,
            background: "#1a1a1a", color: "#fff",
            padding: "0.75rem 0.9rem", borderRadius: 8,
            fontSize: "0.82rem", lineHeight: 1.55,
            zIndex: 60,
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
            textTransform: "none", letterSpacing: 0, fontWeight: 400,
            textAlign: "left",
          }}
        >
          {title && (
            <div style={{ fontWeight: 600, marginBottom: "0.35rem", fontFamily: "Georgia, serif", fontStyle: "italic" }}>
              {title}
            </div>
          )}
          <div>{body}</div>
          {examples && examples.length > 0 && (
            <div style={{ marginTop: "0.55rem", paddingTop: "0.5rem", borderTop: "1px solid rgba(255,255,255,0.15)" }}>
              <div style={{ fontWeight: 600, fontSize: "0.72rem", color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.3rem" }}>
                Example{examples.length > 1 ? "s" : ""}
              </div>
              {examples.map((e, i) => (
                <div key={i} style={{ marginTop: i === 0 ? 0 : "0.3rem" }}>
                  • {e}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

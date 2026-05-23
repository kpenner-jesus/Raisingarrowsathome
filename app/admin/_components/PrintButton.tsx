"use client";

export function PrintButton({ label = "Print / Save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      className="ra-btn"
      onClick={() => { if (typeof window !== "undefined") window.print(); }}
    >
      ⎙ {label}
    </button>
  );
}

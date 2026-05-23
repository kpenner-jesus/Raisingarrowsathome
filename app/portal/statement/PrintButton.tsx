"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      className="ra-btn ra-btn-primary"
      onClick={() => { if (typeof window !== "undefined") window.print(); }}
    >
      Print / Save as PDF
    </button>
  );
}

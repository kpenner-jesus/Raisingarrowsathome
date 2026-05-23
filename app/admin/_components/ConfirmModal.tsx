"use client";
import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Module-level stack — only the top-most ConfirmModal handles Esc/Enter.
const modalStack: number[] = [];
let nextModalId = 1;

export function ConfirmModal({
  open, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel",
  destructive, busy, onConfirm, onCancel,
}: Props) {
  const idRef = useRef<number>(0);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Register this modal on the stack
    if (idRef.current === 0) idRef.current = nextModalId++;
    modalStack.push(idRef.current);

    const onKey = (e: KeyboardEvent) => {
      // Only respond if WE are the top of the stack
      if (modalStack[modalStack.length - 1] !== idRef.current) return;
      if (busy) return;
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      if (e.key === "Enter")  { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener("keydown", onKey);
    // Auto-focus the cancel button so screen-readers + keyboard users land safely.
    setTimeout(() => cancelRef.current?.focus(), 30);

    return () => {
      window.removeEventListener("keydown", onKey);
      const ix = modalStack.lastIndexOf(idRef.current);
      if (ix >= 0) modalStack.splice(ix, 1);
    };
  }, [open, onCancel, onConfirm, busy]);

  if (!open) return null;

  return (
    <div className="ra-modal-backdrop" onClick={() => !busy && onCancel()}>
      <div className="ra-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="ra-h2" style={{ marginBottom: "0.5rem" }}>{title}</h2>
        {body && <p className="ra-quiet" style={{ marginBottom: "1.25rem" }}>{body}</p>}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button ref={cancelRef} className="ra-btn ra-btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`ra-btn ${destructive ? "ra-btn-danger" : "ra-btn-accent"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

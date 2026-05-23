"use client";
import { useEffect } from "react";

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

export function ConfirmModal({
  open, title, body, confirmLabel = "Confirm", cancelLabel = "Cancel",
  destructive, busy, onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter")  onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div className="ra-modal-backdrop" onClick={onCancel}>
      <div className="ra-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="ra-h2" style={{ marginBottom: "0.5rem" }}>{title}</h2>
        {body && <p className="ra-quiet" style={{ marginBottom: "1.25rem" }}>{body}</p>}
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button className="ra-btn ra-btn-ghost" onClick={onCancel} disabled={busy}>
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

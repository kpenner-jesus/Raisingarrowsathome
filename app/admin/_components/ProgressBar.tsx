// Linear progress bar (paid / cap).
// pct should be 0..1.

interface Props {
  value: number;   // 0..1
  variant?: "default" | "success";
  ariaLabel?: string;
}

export function ProgressBar({ value, variant = "default", ariaLabel }: Props) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div
      className={`ra-progress ${variant === "success" ? "ra-progress-track-success" : ""}`}
      role="progressbar"
      aria-valuenow={Math.round(pct * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div className="ra-progress-fill" style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

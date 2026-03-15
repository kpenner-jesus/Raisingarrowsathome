"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../store";
import { SITE_CONFIG } from "../../siteConfig";

export default function IncomePage() {
  const router = useRouter();
  const storedIncome  = useAppStore((s) => s.incomeRange);
  const setIncomeRange = useAppStore((s) => s.setIncomeRange);

  const [selected, setSelected] = useState(storedIncome || "");
  const [error,    setError]    = useState("");

  const progress = Math.round((4 / 7) * 100);

  const handleContinue = () => {
    if (!selected) { setError("Please select your household income range."); return; }
    setIncomeRange(selected);
    router.push("/apply/video");
  };

  return (
    <div className="tf-step">
      <div className="tf-progress">
        <div className="tf-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="tf-body">
        <div className="tf-step-label tf-animate">Step 4 of 6</div>

        <h1 className="tf-question tf-animate tf-animate-delay-1">
          What is your household <em>income range</em>?
        </h1>

        <p className="tf-subtext tf-animate tf-animate-delay-2">
          This helps us prioritize families with the greatest financial need.
          All information is kept confidential.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", width: "100%" }}>
          {SITE_CONFIG.incomeRanges.map((range, i) => (
            <button
              key={range}
              className={`tf-choice tf-animate tf-animate-delay-${i + 3} ${selected === range ? "selected" : ""}`}
              onClick={() => {
                setSelected(range);
                setError("");
                // Auto-advance after short delay
                setTimeout(() => {
                  setIncomeRange(range);
                  router.push("/apply/video");
                }, 250);
              }}
            >
              <span className="tf-choice-key">{String.fromCharCode(65 + i)}</span>
              <span className="tf-choice-text">
                <span className="tf-choice-name">{range}</span>
              </span>
              <svg viewBox="0 0 16 16" fill="none" style={{ width: 14, height: 14, color: "var(--text-muted)", flexShrink: 0 }}>
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          ))}
        </div>

        {error && (
          <div className="tf-alert-error" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}

        <div className="tf-hint tf-animate" style={{ animationDelay: "0.5s" }}>
          <kbd>A</kbd><kbd>B</kbd><kbd>C</kbd><kbd>D</kbd>
          <span>— press a key to select</span>
        </div>

        <button className="tf-back" onClick={() => router.push(`/apply/questions/${SITE_CONFIG.questions.length - 1}`)}>
          ← Back
        </button>
      </div>
    </div>
  );
}

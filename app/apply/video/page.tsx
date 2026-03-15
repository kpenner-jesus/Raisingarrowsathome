"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../store";
import { SITE_CONFIG } from "../../siteConfig";

export default function VideoPage() {
  const router   = useRouter();
  const storedLink = useAppStore((s) => s.videoLink);
  const setVideoLink = useAppStore((s) => s.setVideoLink);

  const [link,  setLink]  = useState(storedLink || "");
  const [error, setError] = useState("");

  const progress = Math.round((5 / 7) * 100);

  const handleContinue = () => {
    if (!link.trim()) {
      setError("Please provide a link to your video.");
      return;
    }
    if (!link.includes("http")) {
      setError("Please enter a valid URL starting with https://");
      return;
    }
    setVideoLink(link.trim());
    router.push("/apply/contact");
  };

  return (
    <div className="tf-step">
      <div className="tf-progress">
        <div className="tf-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="tf-body">
        <div className="tf-step-label tf-animate">Step 5 of 6</div>

        <h1 className="tf-question tf-animate tf-animate-delay-1">
          Your <em>video interview</em>
        </h1>

        <p className="tf-subtext tf-animate tf-animate-delay-2">
          Record a 4–10 minute video of you and your spouse (or just you
          if you are a single parent) answering the questions below.
          Then upload it to YouTube (unlisted) or Google Drive and
          paste the link here.
        </p>

        {/* Video questions */}
        <div className="tf-animate tf-animate-delay-2" style={{
          background: "rgba(255,255,255,0.72)",
          border: "1.5px solid rgba(0,0,0,0.09)",
          borderRadius: "var(--radius-lg)",
          padding: "1.25rem 1.5rem",
          marginBottom: "1.5rem",
          boxShadow: "var(--shadow-card)",
        }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.875rem" }}>
            Answer these 3 questions in your video
          </div>
          {SITE_CONFIG.videoQuestions.map((q, i) => (
            <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: i < SITE_CONFIG.videoQuestions.length - 1 ? "0.75rem" : 0 }}>
              <span style={{
                width: 24, height: 24, borderRadius: "50%",
                background: "var(--accent)", color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.72rem", fontWeight: 700, flexShrink: 0,
              }}>
                {i + 1}
              </span>
              <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: 1.6, fontWeight: 300 }}>
                {q}
              </span>
            </div>
          ))}
        </div>

        {/* Upload instructions */}
        <div className="tf-animate tf-animate-delay-3" style={{
          background: "rgba(232,121,58,0.06)",
          border: "1px solid rgba(232,121,58,0.2)",
          borderRadius: "var(--radius-md)",
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
        }}>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.7, fontWeight: 300 }}>
            <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>How to share your video:</strong>
            <br />
            <strong>YouTube:</strong> Upload → set to Unlisted → copy the link
            <br />
            <strong>Google Drive:</strong> Upload → right-click → Share → Anyone with the link → copy
          </div>
        </div>

        {/* Link input */}
        <div className="tf-animate tf-animate-delay-3" style={{ width: "100%" }}>
          <label style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", display: "block", marginBottom: "0.5rem" }}>
            Video link
          </label>
          <input
            type="url"
            value={link}
            onChange={(e) => { setLink(e.target.value); setError(""); }}
            placeholder="https://youtube.com/watch?v=... or https://drive.google.com/..."
            className="tf-input-box"
          />
        </div>

        {error && (
          <div className="tf-alert-error" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}

        <button className="tf-ok" onClick={handleContinue} style={{ marginTop: "1.5rem" }}>
          Continue
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <div className="tf-hint"><kbd>Enter</kbd><span>to continue</span></div>
        <button className="tf-back" onClick={() => router.push("/apply/income")}>← Back</button>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../store";

export default function ContactPage() {
  const router = useRouter();
  const storedEmail = useAppStore((s) => s.contactEmail);
  const storedPhone = useAppStore((s) => s.contactPhone);
  const setContactEmail = useAppStore((s) => s.setContactEmail);
  const setContactPhone = useAppStore((s) => s.setContactPhone);

  const [email, setEmail] = useState(storedEmail || "");
  const [phone, setPhone] = useState(storedPhone || "");
  const [error, setError] = useState("");

  const progress = Math.round((6 / 7) * 100);

  const handleContinue = () => {
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!phone.trim()) {
      setError("Please enter a phone number.");
      return;
    }
    setContactEmail(email.trim());
    setContactPhone(phone.trim());
    router.push("/apply/review");
  };

  return (
    <div className="tf-step">
      <div className="tf-progress">
        <div className="tf-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="tf-body">
        <div className="tf-step-label tf-animate">Step 6 of 6</div>

        <h1 className="tf-question tf-animate tf-animate-delay-1">
          How do we <em>reach you</em>?
        </h1>

        <p className="tf-subtext tf-animate tf-animate-delay-2">
          We will use these to notify you of your application status
          and send reimbursements if approved.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", width: "100%" }}>

          <div className="tf-animate tf-animate-delay-2">
            <label style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", display: "block", marginBottom: "0.5rem" }}>
              Email address
            </label>
            <input type="email" value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="yourfamily@email.com"
              className="tf-input-box" />
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.35rem", fontWeight: 300 }}>
              Reimbursements will be sent as an e-transfer to this email.
            </div>
          </div>

          <div className="tf-animate tf-animate-delay-3">
            <label style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", display: "block", marginBottom: "0.5rem" }}>
              Cell phone number
            </label>
            <input type="tel" value={phone}
              onChange={(e) => { setPhone(e.target.value); setError(""); }}
              placeholder="(204) 555-0123"
              className="tf-input-box" />
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.35rem", fontWeight: 300 }}>
              We may also send e-transfers to your cell number.
            </div>
          </div>

        </div>

        {error && (
          <div className="tf-alert-error" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}

        <button className="tf-ok" onClick={handleContinue} style={{ marginTop: "1.5rem" }}>
          Review my application
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <div className="tf-hint"><kbd>Enter</kbd><span>to continue</span></div>
        <button className="tf-back" onClick={() => router.push("/apply/video")}>← Back</button>
      </div>
    </div>
  );
}

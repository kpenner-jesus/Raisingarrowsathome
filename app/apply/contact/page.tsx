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
  const storedStreet    = useAppStore((s) => s.addressStreet);
  const storedProvince  = useAppStore((s) => s.addressProvince);
  const storedPostal    = useAppStore((s) => s.addressPostal);
  const storedConsent   = useAppStore((s) => s.mailConsent);
  const setAddressStreet   = useAppStore((s) => s.setAddressStreet);
  const setAddressProvince = useAppStore((s) => s.setAddressProvince);
  const setAddressPostal   = useAppStore((s) => s.setAddressPostal);
  const setMailConsent     = useAppStore((s) => s.setMailConsent);
  const storedCity      = useAppStore((s) => s.city);

  const [email, setEmail] = useState(storedEmail || "");
  const [phone, setPhone] = useState(storedPhone || "");
  const [street, setStreet]     = useState(storedStreet || "");
  const [province, setProvince] = useState(storedProvince || "");
  const [postal, setPostal]     = useState(storedPostal || "");
  const [consent, setConsent]   = useState(!!storedConsent);
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
    if (!street.trim()) {
      setError("Please enter your street address so we can post cheques and tax receipts.");
      return;
    }
    if (!postal.trim()) {
      setError("Please enter your postal code.");
      return;
    }
    setContactEmail(email.trim());
    setContactPhone(phone.trim());
    setAddressStreet(street.trim());
    setAddressProvince(province.trim());
    setAddressPostal(postal.trim());
    setMailConsent(consent);
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

          <div className="tf-animate tf-animate-delay-3">
            <label style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", display: "block", marginBottom: "0.5rem" }}>
              Mailing address
            </label>
            <input type="text" value={street}
              onChange={(e) => { setStreet(e.target.value); setError(""); }}
              placeholder="123 Main Street"
              autoComplete="address-line1"
              className="tf-input-box" />
            <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem" }}>
              <input type="text" value={province}
                onChange={(e) => { setProvince(e.target.value); setError(""); }}
                placeholder="Province"
                autoComplete="address-level1"
                className="tf-input-box" style={{ flex: 1 }} />
              <input type="text" value={postal}
                onChange={(e) => { setPostal(e.target.value); setError(""); }}
                placeholder="R0E 1Z0"
                autoComplete="postal-code"
                className="tf-input-box" style={{ flex: 1 }} />
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.35rem", fontWeight: 300 }}>
              {storedCity
                ? <>We have your city as <strong>{storedCity}</strong>. This is where cheques and tax receipts would be posted.</>
                : <>Where cheques and tax receipts would be posted.</>}
            </div>
          </div>

          <label className="tf-animate tf-animate-delay-3" style={{
            display: "flex", alignItems: "flex-start", gap: "0.6rem",
            background: "rgba(0,0,0,0.02)", border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: "var(--radius-sm, 10px)", padding: "0.85rem 1rem", cursor: "pointer",
          }}>
            <input type="checkbox" checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              style={{ marginTop: "0.15rem", width: 18, height: 18, flexShrink: 0, cursor: "pointer" }} />
            <span style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
              I&apos;m happy for CEO Ministries to send me mail at this address.
              <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem", fontWeight: 300 }}>
                Occasional news and updates about the ministry — separate from anything to do
                with your grant, which we will always send you either way. Ticking this is
                optional and does not affect your application, and you can ask us to stop at
                any time by replying to any email or writing to us.
              </span>
            </span>
          </label>

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

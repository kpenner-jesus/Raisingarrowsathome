"use client";
import { useRouter } from "next/navigation";
import { SITE_CONFIG } from "../../siteConfig";

export default function SuccessPage() {
  const router = useRouter();

  return (
    <div className="tf-step">
      <div className="tf-progress">
        <div className="tf-progress-fill" style={{ width: "100%" }} />
      </div>

      <div className="tf-body" style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>

        <div className="tf-animate" style={{ fontSize: "3.5rem", marginBottom: "1rem" }}>
          🏹
        </div>

        <h1 className="tf-animate tf-animate-delay-1" style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(1.8rem, 5vw, 2.8rem)",
          fontWeight: 500,
          marginBottom: "0.75rem",
          lineHeight: 1.2,
        }}>
          Application <em style={{ color: "var(--accent)" }}>received!</em>
        </h1>

        <p className="tf-animate tf-animate-delay-2" style={{
          color: "var(--text-secondary)", maxWidth: "380px",
          lineHeight: 1.7, fontWeight: 300, fontSize: "1rem",
          marginBottom: "2rem",
        }}>
          Thank you for applying to Raising Arrows. We have received
          your application and will review it carefully.
          You will hear back within <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>30 days</strong>.
        </p>

        {/* What happens next */}
        <div className="tf-animate tf-animate-delay-3" style={{
          background: "rgba(255,255,255,0.72)",
          border: "1.5px solid rgba(0,0,0,0.09)",
          borderRadius: "var(--radius-lg)",
          padding: "1.5rem",
          maxWidth: 380,
          width: "100%",
          textAlign: "left",
          boxShadow: "var(--shadow-card)",
          marginBottom: "2rem",
        }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "1rem" }}>
            What happens next
          </div>
          {[
            { step: "1", text: "We review your written application and video" },
            { step: "2", text: "You hear back within 30 days" },
            { step: "3", text: "If approved, submit receipts to " + SITE_CONFIG.orgEmail },
            { step: "4", text: "E-transfer sent within 7 days of receiving receipts" },
          ].map((item) => (
            <div key={item.step} style={{ display: "flex", gap: "0.875rem", marginBottom: "0.875rem", alignItems: "flex-start" }}>
              <span style={{
                width: 24, height: 24, borderRadius: "50%",
                background: "var(--accent)", color: "white",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.72rem", fontWeight: 700, flexShrink: 0,
                marginTop: "0.1rem",
              }}>
                {item.step}
              </span>
              <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.6, fontWeight: 300 }}>
                {item.text}
              </span>
            </div>
          ))}
        </div>

        <p className="tf-animate tf-animate-delay-4" style={{
          fontSize: "0.78rem", color: "var(--text-muted)",
          marginBottom: "1.5rem", fontWeight: 300,
        }}>
          Questions? Email us at{" "}
          <a href={`mailto:${SITE_CONFIG.orgEmail}`}
            style={{ color: "var(--accent)", textDecoration: "none" }}>
            {SITE_CONFIG.orgEmail}
          </a>
        </p>

        <button
          className="tf-ok tf-animate tf-animate-delay-4"
          onClick={() => router.push("/")}
          style={{ borderRadius: 100 }}>
          Back to home
        </button>

      </div>
    </div>
  );
}

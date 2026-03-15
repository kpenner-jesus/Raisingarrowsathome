"use client";
import { useRouter } from "next/navigation";
import { SITE_CONFIG } from "./siteConfig";

export default function LandingPage() {
  const router = useRouter();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-gradient)" }}>

      {/* ── HERO ─────────────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, #fde8c8 0%, #fdf3e3 50%, #f0eafa 100%)",
        padding: "4rem 1.5rem 3rem",
        textAlign: "center",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
      }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            background: "rgba(232,121,58,0.1)", border: "1px solid rgba(232,121,58,0.25)",
            borderRadius: 100, padding: "0.35rem 1rem", marginBottom: "1.5rem",
          }}>
            <span style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent)" }}>
              Manitoba · Christian Families · First Year
            </span>
          </div>

          <h1 style={{
            fontFamily: "var(--font-display)", fontSize: "clamp(2.2rem, 6vw, 3.5rem)",
            fontWeight: 500, color: "var(--text-primary)", lineHeight: 1.15,
            marginBottom: "1rem", letterSpacing: "-0.01em",
          }}>
            Raising <em style={{ color: "var(--accent)", fontStyle: "italic" }}>Arrows</em>
          </h1>

          <p style={{
            fontSize: "clamp(1rem, 2.5vw, 1.2rem)", color: "var(--text-secondary)",
            lineHeight: 1.7, marginBottom: "2rem", fontWeight: 300,
          }}>
            We help Christian families in Manitoba launch into homeschooling
            for the very first time by providing financial assistance for
            curriculum and educational resources during their first year.
          </p>

          <button
            onClick={() => router.push("/apply/family")}
            className="tf-ok"
            style={{ fontSize: "1rem", padding: "1rem 2.5rem", borderRadius: 100 }}>
            Apply for a Grant
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 18, height: 18 }}>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "1rem", fontWeight: 300 }}>
            Free to apply · Hear back within 30 days · Manitoba families only
          </p>
        </div>
      </div>

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "4rem 1.5rem" }}>

        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div className="tf-step-label" style={{ justifyContent: "center", display: "flex", marginBottom: "0.5rem" }}>How it works</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 500 }}>
            We reimburse 75% of your first-year costs
          </h2>
        </div>

        {/* Funding caps */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "3rem" }}>
          {SITE_CONFIG.fundingCaps.map((tier) => (
            <div key={tier.label} style={{
              background: "rgba(255,255,255,0.72)", border: "1.5px solid rgba(0,0,0,0.09)",
              borderRadius: "var(--radius-lg)", padding: "1.25rem 1rem", textAlign: "center",
              boxShadow: "var(--shadow-card)",
            }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                {tier.label}
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", fontWeight: 500, color: "var(--accent)", lineHeight: 1 }}>
                ${tier.cap}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                reimbursed
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                (you spend ${tier.spend})
              </div>
            </div>
          ))}
        </div>

        {/* What you also receive */}
        <div style={{
          background: "rgba(255,255,255,0.72)", border: "1.5px solid rgba(0,0,0,0.09)",
          borderRadius: "var(--radius-lg)", padding: "1.5rem 1.75rem", marginBottom: "3rem",
          boxShadow: "var(--shadow-card)",
        }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", fontWeight: 500, marginBottom: "1rem" }}>
            If accepted, you also receive:
          </div>
          {SITE_CONFIG.bonusItems.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", marginBottom: "0.6rem" }}>
              <span style={{ color: "var(--accent)", fontSize: "1rem", marginTop: "0.1rem", flexShrink: 0 }}>✦</span>
              <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontWeight: 300, lineHeight: 1.6 }}>{item}</span>
            </div>
          ))}
        </div>

        {/* About us */}
        <div style={{ marginBottom: "3rem" }}>
          <div className="tf-step-label" style={{ marginBottom: "0.75rem" }}>About us</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", fontWeight: 500, marginBottom: "1rem" }}>
            A family who has walked this road
          </h2>
          <div style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(0,0,0,0.07)", borderRadius: "var(--radius-lg)", padding: "1.5rem 1.75rem" }}>
            <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", lineHeight: 1.8, fontWeight: 300, marginBottom: "1rem" }}>
              We are a family of 7 who started our homeschooling journey 5 years ago. Our inspiration came from a deep conviction that we are called to be the main influence in our kids lives in their most formative years.
            </p>
            <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", lineHeight: 1.8, fontWeight: 300 }}>
              We believe that God&apos;s original design is for kids to be taught, coached and corrected by those that know them best and love them the most — their parents.
            </p>
          </div>
        </div>

        {/* Who it is for */}
        <div style={{ marginBottom: "3rem" }}>
          <div className="tf-step-label" style={{ marginBottom: "0.75rem" }}>Who it is for</div>
          <div style={{ background: "rgba(255,255,255,0.72)", border: "1.5px solid rgba(0,0,0,0.09)", borderRadius: "var(--radius-lg)", padding: "1.5rem 1.75rem", boxShadow: "var(--shadow-card)" }}>
            <p style={{ fontSize: "0.95rem", color: "var(--text-secondary)", lineHeight: 1.8, fontWeight: 300 }}>
              Families that are considering homeschool <strong style={{ color: "var(--text-primary)", fontWeight: 500 }}>for the first time</strong> but are financially strained by the prospect of it.
              You must never have registered with the government previously for homeschooling any of your children.
            </p>
          </div>
        </div>

        {/* FAQ */}
        <div style={{ marginBottom: "3rem" }}>
          <div className="tf-step-label" style={{ marginBottom: "0.75rem" }}>FAQ</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {SITE_CONFIG.faqs.map((faq, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.72)", border: "1.5px solid rgba(0,0,0,0.09)",
                borderRadius: "var(--radius-md)", padding: "1.25rem 1.5rem",
                boxShadow: "var(--shadow-card)",
              }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.5rem", color: "var(--text-primary)" }}>
                  {faq.q}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.7, fontWeight: 300 }}>
                  {faq.a}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div style={{
          textAlign: "center", background: "rgba(255,255,255,0.72)",
          border: "1.5px solid rgba(232,121,58,0.2)", borderRadius: "var(--radius-xl)",
          padding: "2.5rem 2rem", boxShadow: "var(--shadow-hover)",
        }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", fontWeight: 500, marginBottom: "0.75rem" }}>
            Ready to take the first step?
          </h2>
          <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "1.75rem", fontWeight: 300, lineHeight: 1.6 }}>
            The application takes about 15 minutes to complete.
            You will need a short video (4–10 min) of you and your spouse
            answering three questions.
          </p>
          <button
            onClick={() => router.push("/apply/family")}
            className="tf-ok"
            style={{ fontSize: "1rem", padding: "1rem 2.5rem", borderRadius: 100 }}>
            Start Your Application
            <svg viewBox="0 0 16 16" fill="none" style={{ width: 18, height: 18 }}>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: "3rem", fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.8 }}>
          <div style={{ marginBottom: "0.25rem", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "0.9rem" }}>
            Raising Arrows
          </div>
          <a href={`mailto:${SITE_CONFIG.orgEmail}`}
            style={{ color: "var(--text-muted)", textDecoration: "none" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
            {SITE_CONFIG.orgEmail}
          </a>
        </div>
      </div>
    </div>
  );
}

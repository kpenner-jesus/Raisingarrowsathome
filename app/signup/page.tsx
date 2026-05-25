// /signup — public landing for new tenants.
// Email magic link → /signup/new-org wizard.
"use client";

import { Suspense, useState } from "react";
import { supabaseBrowser } from "@/app/lib/supabase/browser";

export const dynamic = "force-dynamic";

function SignupInner() {
  const [email, setEmail] = useState("");
  const [sent, setSent]   = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);

  async function send() {
    if (!email.trim()) { setError("Enter your email."); return; }
    setBusy(true); setError("");
    const supabase = supabaseBrowser();
    const next = "/signup/new-org";
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <main style={{
      minHeight: "80vh", padding: "3rem 1.5rem",
      maxWidth: 520, margin: "0 auto",
      fontFamily: "var(--font-body)",
    }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{
          fontFamily: "var(--font-display)", fontSize: "2rem",
          fontWeight: 500, color: "var(--text-primary)",
          marginBottom: "0.5rem",
        }}>Run a grant program — in 10 minutes.</h1>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, fontSize: "1rem" }}>
          Application intake, receipt review, automated payouts, family portal.
          <br />
          <strong>$20/month</strong>. 14-day free trial. All revenue goes to{" "}
          <a href="https://raisingarrowsathome.com" style={{ color: "var(--accent)" }}>
            Raising Arrows
          </a>{" "}— a CRA-registered charity helping Christian families launch into homeschooling.
        </p>
      </div>

      <div style={{
        background: "rgba(255,255,255,0.95)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: "var(--radius-lg, 14px)",
        padding: "2rem 1.75rem",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}>
        {sent ? (
          <div style={{
            background: "rgba(58,158,110,0.1)",
            border: "1px solid #3a9e6e",
            color: "#3a9e6e",
            padding: "1rem 1.25rem",
            borderRadius: 8,
            lineHeight: 1.6,
          }}>
            Check <strong>{email}</strong> for a magic link. Click it to set up your organization.
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: "1.15rem", marginBottom: "0.5rem", fontWeight: 600 }}>
              Get started — no card, no commitment
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1rem", lineHeight: 1.5 }}>
              We'll email you a sign-in link. After you click it, you'll name your organization
              and pick a URL slug. Card not needed until day 14.
            </p>
            <input
              type="email" inputMode="email" autoComplete="email"
              placeholder="you@yourchurch.org"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              autoFocus
              style={{
                width: "100%", padding: "0.85rem 1rem", fontSize: 16,
                border: "1px solid rgba(0,0,0,0.15)", borderRadius: 10,
                fontFamily: "var(--font-body)",
              }}
            />
            {error && (
              <div style={{
                marginTop: "0.75rem", padding: "0.7rem 1rem", borderRadius: 8,
                background: "rgba(224,80,80,0.08)", color: "#a83232", fontSize: "0.88rem",
              }}>{error}</div>
            )}
            <button
              onClick={send}
              disabled={busy}
              style={{
                marginTop: "1rem", width: "100%",
                padding: "0.95rem 1.5rem",
                background: "linear-gradient(180deg, var(--accent, #e8793a), #c45f20)",
                color: "#fff", border: "none", borderRadius: 100,
                fontFamily: "var(--font-body)", fontSize: "1rem", fontWeight: 600,
                cursor: "pointer", minHeight: 52,
                boxShadow: "0 4px 12px rgba(232,121,58,0.35)",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? "Sending…" : "Email me a magic link →"}
            </button>
          </>
        )}
      </div>

      <p style={{ marginTop: "2rem", fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "center" }}>
        Already have an account?{" "}
        <a href="/auth/login" style={{ color: "var(--accent)" }}>Sign in</a>
      </p>
      <p style={{ marginTop: "0.8rem", fontSize: "0.78rem", color: "var(--text-muted)", textAlign: "center" }}>
        By signing up you agree to the{" "}
        <a href="/platform-terms" style={{ color: "var(--text-muted)" }}>platform terms + privacy</a>.
      </p>
    </main>
  );
}

export default function SignupPage() {
  return <Suspense fallback={null}><SignupInner /></Suspense>;
}

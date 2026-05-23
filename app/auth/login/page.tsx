"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/browser";
import { KidsBehind } from "@/app/_components/Kids";

function LoginInner() {
  const [email, setEmail] = useState("");
  const [sent,  setSent]  = useState(false);
  const [error, setError] = useState("");
  const [busy,  setBusy]  = useState(false);
  const params = useSearchParams();
  const rawNext = params.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") && !/^[a-z]+:/i.test(rawNext)
    ? rawNext
    : "/portal";

  const send = async () => {
    if (!email.trim()) { setError("Please enter your email."); return; }
    setBusy(true); setError("");
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  };

  return (
    <div className="tf-step">
      <div className="tf-body" style={{ alignItems: "center", textAlign: "center", maxWidth: 440, margin: "0 auto" }}>
        <KidsBehind
          kids={[
            { variant: 0, left: "12%" },
            { variant: 1, left: "38%" },
            { variant: 2, left: "62%" },
            { variant: 3, left: "85%" },
          ]}
        >
          <div style={{
            background: "rgba(255,255,255,0.96)",
            border: "1.5px solid rgba(0,0,0,0.08)",
            borderRadius: "var(--radius-lg)",
            padding: "2rem 1.75rem 1.75rem",
            boxShadow: "var(--shadow-card)",
          }}>
            <h1 className="tf-question" style={{ marginBottom: "0.5rem" }}>Sign in</h1>
            <p className="tf-subtext" style={{ marginBottom: "1.25rem" }}>We will email you a magic link — no password.</p>

            {sent ? (
              <div style={{ background: "rgba(58,158,110,0.1)", border: "1px solid var(--success)", color: "var(--success)", padding: "1rem 1.25rem", borderRadius: "var(--radius-md)" }}>
                Check <strong>{email}</strong> for your sign-in link.
              </div>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                  placeholder="you@email.com"
                  className="tf-input-box"
                  autoFocus
                />
                {error && <div className="tf-alert-error" style={{ marginTop: "1rem" }}>{error}</div>}
                <button className="tf-ok" disabled={busy} onClick={send} style={{ marginTop: "1.25rem" }}>
                  {busy ? "Sending…" : "Send magic link"}
                </button>
              </>
            )}
          </div>
        </KidsBehind>

        <a
          href="/"
          style={{
            display: "inline-block",
            marginTop: "1.25rem",
            fontSize: "0.85rem",
            color: "var(--text-muted)",
            textDecoration: "none",
            borderBottom: "1px dotted rgba(0,0,0,0.25)",
            paddingBottom: 1,
          }}
        >
          ← Back to website
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="tf-step" />}>
      <LoginInner />
    </Suspense>
  );
}

"use client";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/browser";

function LoginInner() {
  const [email, setEmail] = useState("");
  const [sent,  setSent]  = useState(false);
  const [error, setError] = useState("");
  const [busy,  setBusy]  = useState(false);
  const params = useSearchParams();
  // Defense-in-depth: only honor same-origin relative paths.
  // The server callback re-validates, but sanitizing here keeps the
  // intermediate magic-link URL from carrying a phishing destination.
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
      <div className="tf-body" style={{ alignItems: "center", textAlign: "center", maxWidth: 440 }}>
        <h1 className="tf-question">Sign in</h1>
        <p className="tf-subtext">We will email you a magic link — no password.</p>

        {sent ? (
          <div style={{ background: "rgba(58,158,110,0.1)", border: "1px solid var(--success)", color: "var(--success)", padding: "1rem 1.25rem", borderRadius: "var(--radius-md)", marginTop: "1rem" }}>
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
            <button className="tf-ok" disabled={busy} onClick={send} style={{ marginTop: "1.5rem" }}>
              {busy ? "Sending…" : "Send magic link"}
            </button>
          </>
        )}
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

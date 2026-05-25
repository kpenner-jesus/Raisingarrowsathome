// /signup/new-org — post-auth wizard. User picks org name + slug, we create
// the tenant + their org_members row + redirect them into their fresh admin.
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabase/browser";

export const dynamic = "force-dynamic";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 62);
}

export default function NewOrgPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn,    setSignedIn]    = useState(false);
  const [name,        setName]        = useState("");
  const [slug,        setSlug]        = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [charityNumber, setCharityNumber] = useState("");
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState("");

  useEffect(() => {
    (async () => {
      const supabase = supabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      setSignedIn(!!user);
      setAuthChecked(true);
      if (!user) router.replace("/signup");
    })();
  }, [router]);

  // Auto-slug from name unless the user has edited the slug themselves.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  async function submit() {
    setError("");
    if (!name.trim()) { setError("Organization name is required."); return; }
    if (!slug || slug.length < 3) { setError("URL slug must be at least 3 characters."); return; }
    if (!/^[a-z0-9][a-z0-9-]+[a-z0-9]$/.test(slug)) {
      setError("URL slug can only contain lowercase letters, digits, and hyphens.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/signup/create-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug,
          charity_number: charityNumber.trim() || null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      // Redirect to the new org's admin. Server returns the right URL based
      // on host (legacy raisingarrowsathome.com bare /admin, otherwise /o/<slug>/admin).
      window.location.href = j.redirect_url || `/o/${slug}/admin`;
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  if (!authChecked) return <div style={{ padding: "3rem", textAlign: "center" }}>Loading…</div>;
  if (!signedIn) return null;

  return (
    <main style={{
      minHeight: "80vh", padding: "3rem 1.5rem",
      maxWidth: 560, margin: "0 auto",
      fontFamily: "var(--font-body)",
    }}>
      <h1 style={{
        fontFamily: "var(--font-display)", fontSize: "1.8rem",
        marginBottom: "0.5rem", fontWeight: 500,
      }}>Name your organization</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "2rem", lineHeight: 1.55 }}>
        This is how your charity appears to applicants + grant recipients.
        You can change branding (logo, colours) later in Settings.
      </p>

      <div style={{
        background: "rgba(255,255,255,0.95)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 14,
        padding: "1.75rem",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}>
        <label style={{ display: "block", fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.3rem" }}>
          Organization name
        </label>
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          placeholder="Cedar Springs Family Grants"
          autoFocus
          style={{
            width: "100%", padding: "0.75rem 1rem", fontSize: 16,
            border: "1px solid rgba(0,0,0,0.15)", borderRadius: 10,
            marginBottom: "1rem", fontFamily: "var(--font-body)",
          }}
        />

        <label style={{ display: "block", fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.3rem" }}>
          URL slug
          <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.4rem", fontSize: "0.8rem" }}>
            (your portal URL: app.example.com/o/<strong>{slug || "your-slug"}</strong>/...)
          </span>
        </label>
        <input
          value={slug}
          onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); setError(""); }}
          placeholder="cedar-springs"
          style={{
            width: "100%", padding: "0.75rem 1rem", fontSize: 16,
            border: "1px solid rgba(0,0,0,0.15)", borderRadius: 10,
            marginBottom: "1rem", fontFamily: "ui-monospace, monospace",
          }}
        />

        <label style={{ display: "block", fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.3rem" }}>
          CRA charity number{" "}
          <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: "0.8rem" }}>
            (optional — add later)
          </span>
        </label>
        <input
          value={charityNumber}
          onChange={(e) => setCharityNumber(e.target.value)}
          placeholder="e.g. 803489451 RR0001"
          style={{
            width: "100%", padding: "0.75rem 1rem", fontSize: 16,
            border: "1px solid rgba(0,0,0,0.15)", borderRadius: 10,
            marginBottom: "1.25rem", fontFamily: "var(--font-body)",
          }}
        />

        {error && (
          <div style={{
            padding: "0.7rem 1rem", borderRadius: 8,
            background: "rgba(224,80,80,0.08)", color: "#a83232",
            fontSize: "0.88rem", marginBottom: "1rem",
          }}>{error}</div>
        )}

        <button
          onClick={submit}
          disabled={busy}
          style={{
            width: "100%", padding: "0.95rem 1.5rem",
            background: "linear-gradient(180deg, var(--accent, #e8793a), #c45f20)",
            color: "#fff", border: "none", borderRadius: 100,
            fontFamily: "var(--font-body)", fontSize: "1rem", fontWeight: 600,
            cursor: "pointer", minHeight: 52,
            boxShadow: "0 4px 12px rgba(232,121,58,0.35)",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Setting up your portal…" : "Create my organization →"}
        </button>
      </div>

      <p style={{ marginTop: "2rem", fontSize: "0.8rem", color: "var(--text-muted)", textAlign: "center", lineHeight: 1.6 }}>
        Your 14-day free trial starts now. Card not required until day 14.
        <br />
        $20 USD/month afterwards — all revenue donated to Raising Arrows.
      </p>
    </main>
  );
}

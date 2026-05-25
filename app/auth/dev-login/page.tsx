"use client";
// /auth/dev-set (page) — DEV-ONLY client-side helper that reads
// Supabase implicit-flow tokens out of the URL hash and POSTs them
// to the matching route handler (which sets the session cookie
// server-side via @supabase/ssr, handling chunking properly).
//
// Flow: a magic link with redirect_to=http://localhost:3002/auth/dev-set?next=/admin/mcp
// lands the user here with `#access_token=...&refresh_token=...`.
// We grab those, POST to /auth/dev-set, and follow the redirect.

import { useEffect, useState } from "react";

export default function DevSetPage() {
  const [status, setStatus] = useState("Reading tokens…");

  useEffect(() => {
    (async () => {
      try {
        const hash = window.location.hash.slice(1);
        if (!hash) {
          setStatus("No tokens in URL hash. Run the magic link first.");
          return;
        }
        const params = new URLSearchParams(hash);
        const access_token  = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (!access_token || !refresh_token) {
          setStatus("Missing access_token or refresh_token in hash.");
          return;
        }
        // Read `next` from query string set by the magic link's redirect_to
        const qp = new URLSearchParams(window.location.search);
        const next = qp.get("next") || "/admin";

        setStatus("Setting server-side session cookie…");

        const r = await fetch("/auth/dev-set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token, refresh_token, next }),
          // Don't auto-follow so we can read the Location header explicitly
          redirect: "manual",
        });

        // POST returns a 303 redirect with Set-Cookie. Browser followed it
        // automatically when redirect:'follow', or we manually pick it up:
        if (r.type === "opaqueredirect" || r.status === 0) {
          // Browser handled the redirect; just navigate to next
          window.location.href = next;
        } else if (r.ok || r.redirected) {
          window.location.href = next;
        } else {
          const body = await r.text().catch(() => "");
          setStatus(`Failed (${r.status}): ${body.slice(0, 300)}`);
        }
      } catch (e: any) {
        setStatus(`Error: ${e?.message || e}`);
      }
    })();
  }, []);

  return (
    <main style={{
      minHeight: "60vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      fontFamily: "system-ui, sans-serif",
    }}>
      <div style={{
        background: "#fff",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 12,
        padding: "1.25rem 1.5rem",
        maxWidth: 480,
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
      }}>
        <h1 style={{ marginTop: 0, fontSize: "1.1rem", color: "#1a1a1a" }}>Dev login</h1>
        <p style={{ margin: "0.6rem 0 0", color: "#666", fontSize: "0.9rem" }}>{status}</p>
      </div>
    </main>
  );
}

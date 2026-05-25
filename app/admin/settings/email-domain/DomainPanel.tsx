"use client";
// Owner-only UI for adding + verifying the tenant's custom sending domain.
// Two states:
//   - No domain configured yet → input field + "Add my domain" button.
//   - Domain configured (verified or not) → status badge + DNS records +
//     "Check verification" button. "Remove" goes back to shared sender.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type DnsRecord = {
  type: string;       // 'MX', 'TXT', 'CNAME'
  name: string;
  value: string;
  priority?: number;
  ttl?: string | number;
  record?: string;    // Resend's purpose label e.g. 'DKIM', 'SPF', 'DMARC'
};

export function DomainPanel({
  orgId, currentDomain, currentSenderEmail, resendDomainId, verified,
}: {
  orgId: string;
  currentDomain: string | null;
  currentSenderEmail: string | null;
  resendDomainId: string | null;
  verified: boolean;
}) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [senderName, setSenderName] = useState("notifications");
  const [busy, setBusy] = useState<"add" | "verify" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<DnsRecord[] | null>(null);
  const [status, setStatus] = useState<string | null>(verified ? "verified" : (resendDomainId ? "pending" : null));

  // If a domain is already configured, immediately load its records so the
  // user can re-check them.
  useEffect(() => {
    if (resendDomainId && !records) {
      void refreshStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshStatus() {
    setBusy("verify"); setError(null);
    try {
      const r = await fetch("/api/admin/email-domain/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRecords(j.records ?? null);
      setStatus(j.status ?? null);
      if (j.status === "verified") router.refresh();
    } catch (e: any) {
      setError(e?.message || "Verification check failed");
    } finally {
      setBusy(null);
    }
  }

  async function addDomain() {
    setError(null);
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!/^([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(d)) {
      setError("Enter a valid domain (e.g. yourchurch.org)");
      return;
    }
    setBusy("add");
    try {
      const r = await fetch("/api/admin/email-domain/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, domain: d, senderLocalPart: senderName.trim() || "notifications" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRecords(j.records ?? null);
      setStatus(j.status ?? "pending");
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to add domain");
    } finally {
      setBusy(null);
    }
  }

  async function removeDomain() {
    if (!confirm("Remove this sending domain? Emails will fall back to the shared platform sender.")) return;
    setBusy("remove"); setError(null);
    try {
      const r = await fetch("/api/admin/email-domain/create", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to remove domain");
    } finally {
      setBusy(null);
    }
  }

  // ── No domain configured yet ──
  if (!resendDomainId) {
    return (
      <section className="ra-card">
        <h2 className="ra-section-title">Add your sending domain</h2>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: "1rem" }}>
          Until you verify your own domain, emails go out as{" "}
          <code>notifications@raisingarrowsathome.com</code>. That's fine for testing but
          long-term you want your own.
        </p>

        <label className="ra-label">From name (mailbox part)</label>
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "0.6rem", marginBottom: "0.85rem" }}>
          <input
            value={senderName}
            onChange={(e) => setSenderName(e.target.value.replace(/[^a-z0-9._-]/gi, ""))}
            className="ra-input"
            placeholder="notifications"
          />
          <div style={{ alignSelf: "center", color: "var(--text-secondary)" }}>@ your domain</div>
        </div>

        <label className="ra-label">Your domain</label>
        <input
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setError(null); }}
          className="ra-input"
          placeholder="yourchurch.org"
          onKeyDown={(e) => { if (e.key === "Enter") addDomain(); }}
        />

        <p className="ra-tiny" style={{ marginTop: "0.4rem", color: "var(--text-muted)" }}>
          Sending address will be: <code>{senderName || "notifications"}@{domain || "yourchurch.org"}</code>
        </p>

        {error && <div className="ra-alert-error" style={{ marginTop: "0.85rem" }}>{error}</div>}

        <button
          onClick={addDomain}
          disabled={busy === "add"}
          className="ra-btn ra-btn-primary"
          style={{ marginTop: "1rem" }}
        >
          {busy === "add" ? "Adding…" : "Add domain →"}
        </button>
      </section>
    );
  }

  // ── Domain configured ──
  const verifiedBadge = status === "verified" || verified;

  return (
    <>
      <section className="ra-card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 className="ra-section-title">Sending from</h2>
            <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--text-primary)" }}>
              <code>{currentSenderEmail || `notifications@${currentDomain}`}</code>
            </div>
            <div className="ra-tiny" style={{ marginTop: "0.3rem" }}>
              Domain: <code>{currentDomain}</code>
            </div>
          </div>
          <div>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
              padding: "0.35rem 0.85rem", borderRadius: 999, fontWeight: 600, fontSize: "0.85rem",
              background: verifiedBadge ? "rgba(58,158,110,0.12)" : "rgba(232,121,58,0.12)",
              color:     verifiedBadge ? "#2c7a3f"               : "#b75d20",
            }}>
              {verifiedBadge ? "✓ Verified" : "⏳ Pending DNS"}
            </span>
          </div>
        </div>

        <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <button onClick={refreshStatus} disabled={!!busy} className="ra-btn">
            {busy === "verify" ? "Checking…" : "Check verification status"}
          </button>
          <button onClick={removeDomain} disabled={!!busy} className="ra-btn" style={{ background: "rgba(224,80,80,0.08)", color: "#a83232", border: "1px solid rgba(224,80,80,0.3)" }}>
            {busy === "remove" ? "Removing…" : "Remove domain"}
          </button>
        </div>
        {error && <div className="ra-alert-error" style={{ marginTop: "0.85rem" }}>{error}</div>}
      </section>

      {records && records.length > 0 && (
        <section className="ra-card">
          <h2 className="ra-section-title">DNS records to add</h2>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: "1rem" }}>
            Add these records at your DNS provider (Cloudflare, GoDaddy, Namecheap, etc).
            Once all three are propagated (usually 5-30 minutes), click "Check verification status" above.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {records.map((rec, i) => (
              <div key={i} style={{
                background: "var(--bg-soft, #fff)",
                border: "1px solid var(--border, rgba(0,0,0,0.08))",
                borderRadius: 10,
                padding: "0.85rem 1rem",
              }}>
                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "0.4rem", flexWrap: "wrap" }}>
                  <span style={{ background: "#e8d3b0", padding: "0.15rem 0.55rem", borderRadius: 4, fontFamily: "ui-monospace, monospace", fontSize: "0.78rem", fontWeight: 600 }}>{rec.type}</span>
                  {rec.record && <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>{rec.record}</span>}
                </div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.82rem", color: "var(--text-secondary)", display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.4rem 0.85rem" }}>
                  <span>Name:</span>  <code style={{ wordBreak: "break-all" }}>{rec.name}</code>
                  <span>Value:</span> <code style={{ wordBreak: "break-all" }}>{rec.value}</code>
                  {rec.priority != null && <><span>Priority:</span> <code>{rec.priority}</code></>}
                  {rec.ttl && <><span>TTL:</span> <code>{rec.ttl}</code></>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

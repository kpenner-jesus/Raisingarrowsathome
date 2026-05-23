"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Initial {
  parent_names: string;
  contact_email: string;
  contact_phone: string;
  city: string;
  address_street: string;
  address_city: string;
  address_postal: string;
}

export function ProfileForm({
  recipientId, applicationId, initial,
}: {
  recipientId: string;
  applicationId: string;
  initial: Initial;
}) {
  const router = useRouter();
  const [phone,   setPhone]   = useState(initial.contact_phone);
  const [street,  setStreet]  = useState(initial.address_street);
  const [city,    setCity]    = useState(initial.address_city);
  const [postal,  setPostal]  = useState(initial.address_postal);
  const [busy, setBusy]       = useState(false);
  const [msg,  setMsg]        = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/portal/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientId,
          applicationId,
          contact_phone:  phone.trim(),
          address_street: street.trim(),
          address_city:   city.trim(),
          address_postal: postal.trim().toUpperCase(),
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setMsg({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message || "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  const Read = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
    <div>
      <label className="ra-label" style={{ color: "var(--text-muted)" }}>{label}</label>
      <input className="ra-input" value={value} readOnly
        style={{ background: "rgba(0,0,0,0.03)", color: "var(--text-muted)", cursor: "not-allowed" }} />
      {hint && <div className="ra-tiny" style={{ marginTop: "0.2rem" }}>{hint}</div>}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", maxWidth: 560 }}>
      <section className="ra-card">
        <h2 className="ra-section-title">Read-only</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
          <Read label="Family name(s)" value={initial.parent_names}
            hint="Need to update? Email register@raisingarrowsathome.com." />
          <Read label="Sign-in email" value={initial.contact_email}
            hint="Changing email requires admin help to keep your sign-in working." />
        </div>
      </section>

      <section className="ra-card">
        <h2 className="ra-section-title">Editable</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
          <div>
            <label className="ra-label">Phone</label>
            <input className="ra-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} />
          </div>
          <div>
            <label className="ra-label">Street address</label>
            <input className="ra-input" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={120} placeholder="123 Main St" />
          </div>
          <div>
            <label className="ra-label">City / town</label>
            <input className="ra-input" value={city} onChange={(e) => setCity(e.target.value)} maxLength={64} />
          </div>
          <div>
            <label className="ra-label">Postal code</label>
            <input className="ra-input" value={postal} onChange={(e) => setPostal(e.target.value)} maxLength={10} placeholder="R0X 0X0" />
          </div>
        </div>
      </section>

      {msg && <div className={msg.kind === "ok" ? "ra-alert-success" : "ra-alert-error"}>{msg.text}</div>}

      <div>
        <button className="ra-btn ra-btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

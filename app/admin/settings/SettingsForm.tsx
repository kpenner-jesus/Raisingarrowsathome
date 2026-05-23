"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppSettings, FundingTier, IntakeStatus } from "@/app/lib/settings";

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const router = useRouter();
  const [tiers, setTiers]     = useState<FundingTier[]>(initial.fundingCaps);
  const [rate,  setRate]      = useState<number>(initial.reimbursementRate);
  const [months, setMonths]   = useState<number>(initial.submissionDeadlineMonths);
  const [intake, setIntake]   = useState<IntakeStatus>(initial.intakeStatus);
  const [busy, setBusy]       = useState(false);
  const [msg,  setMsg]        = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function updateTier(i: number, patch: Partial<FundingTier>) {
    setTiers((arr) => arr.map((t, idx) => idx === i ? { ...t, ...patch } : t));
  }
  function addTier()    { setTiers((arr) => [...arr, { label: "Ages ?", cap: 0, spend: 0 }]); }
  function removeTier(i: number) { setTiers((arr) => arr.filter((_, idx) => idx !== i)); }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      // Validate locally first
      for (const t of tiers) {
        if (!t.label.trim())                    throw new Error("Every tier needs a label");
        if (!isFinite(t.cap)   || t.cap   < 0)  throw new Error("Every cap must be ≥ 0");
        if (!isFinite(t.spend) || t.spend < 0)  throw new Error("Every typical spend must be ≥ 0");
      }
      if (rate < 0 || rate > 1)                 throw new Error("Reimbursement rate must be 0..1");
      if (!Number.isInteger(months) || months < 1 || months > 36) throw new Error("Deadline must be 1..36 months");

      const r = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: {
            funding_caps: tiers,
            reimbursement_rate: rate,
            submission_deadline_months: months,
            intake_status: intake,
            applications_open: intake !== "closed",
          },
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {msg && (
        <div className={msg.kind === "ok" ? "ra-alert-success" : "ra-alert-error"}>{msg.text}</div>
      )}

      {/* Funding caps */}
      <section className="ra-card">
        <h2 className="ra-section-title">Funding tiers</h2>
        <p className="ra-quiet" style={{ marginTop: 0 }}>
          Each tier shows on the landing page as a card. <em>Cap</em> is the maximum we reimburse.
          <em> Typical spend</em> is the expected first-year out-of-pocket.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {tiers.map((t, i) => (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr)) auto",
              gap: "0.6rem", alignItems: "end",
              padding: "0.75rem", border: "1px dashed var(--ra-line)", borderRadius: 10,
            }}>
              <div>
                <label className="ra-label">Label</label>
                <input className="ra-input" value={t.label}
                  onChange={(e) => updateTier(i, { label: e.target.value })} />
              </div>
              <div>
                <label className="ra-label">Cap ($)</label>
                <input className="ra-input" type="number" min={0} step="1" value={t.cap}
                  onChange={(e) => updateTier(i, { cap: Number(e.target.value) })} />
              </div>
              <div>
                <label className="ra-label">Typical spend ($)</label>
                <input className="ra-input" type="number" min={0} step="1" value={t.spend}
                  onChange={(e) => updateTier(i, { spend: Number(e.target.value) })} />
              </div>
              <button type="button" className="ra-btn" onClick={() => removeTier(i)} title="Remove tier">×</button>
            </div>
          ))}
          <button type="button" className="ra-btn" onClick={addTier}>+ Add tier</button>
        </div>
      </section>

      {/* Other knobs */}
      <section className="ra-card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
        <div>
          <label className="ra-label">Reimbursement rate (0–1)</label>
          <input className="ra-input" type="number" min={0} max={1} step="0.01" value={rate}
            onChange={(e) => setRate(Number(e.target.value))} />
          <div className="ra-tiny">{(rate * 100).toFixed(0)}% of qualifying spend</div>
        </div>
        <div>
          <label className="ra-label">Submission deadline (months)</label>
          <input className="ra-input" type="number" min={1} max={36} step="1" value={months}
            onChange={(e) => setMonths(Number(e.target.value))} />
          <div className="ra-tiny">Recipients have this many months from approval to submit receipts</div>
        </div>
        <div>
          <label className="ra-label">Intake status</label>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.25rem" }}>
            {(["open","waitlist","closed"] as IntakeStatus[]).map((s) => (
              <label key={s} style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.92rem", cursor: "pointer" }}>
                <input type="radio" name="intake" value={s}
                  checked={intake === s}
                  onChange={() => setIntake(s)} />
                <span style={{ textTransform: "capitalize", fontWeight: 500 }}>{s}</span>
                <span className="ra-tiny" style={{ marginLeft: "0.25rem" }}>
                  {s === "open"     && "— funnel accepts applications normally"}
                  {s === "waitlist" && "— funnel accepts, families flagged waitlisted=true"}
                  {s === "closed"   && "— funnel shows closed message, no submissions"}
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <div>
        <button className="ra-btn ra-btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

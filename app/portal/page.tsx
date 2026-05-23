import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";
import { calcBalance } from "@/app/lib/grant-calc";

export const dynamic = "force-dynamic";

export default async function PortalDashboard() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: recipient } = await supabase
    .from("recipients")
    .select("*, applications(parent_names)")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!recipient) {
    return (
      <div style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: "var(--radius-lg)", padding: "2rem 2.25rem" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", marginBottom: "0.75rem" }}>Welcome</h1>
        <p style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Your account is not yet linked to an approved grant. If you believe this is an error, please contact{" "}
          <a href="mailto:register@raisingarrowsathome.com" style={{ color: "var(--accent)" }}>register@raisingarrowsathome.com</a>.
        </p>
      </div>
    );
  }

  const [{ data: receipts }, { data: allPayouts }] = await Promise.all([
    supabase.from("receipts").select("*").eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
    supabase.from("payouts").select("amount, paid_at, status").eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
  ]);

  const paid            = (allPayouts || []).filter((p: any) => p.status === "paid");
  const paidToDate      = paid.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const committedToDate = (allPayouts || []).filter((p: any) => p.status !== "cancelled").reduce((s: number, p: any) => s + Number(p.amount), 0);
  const balance = calcBalance({
    receipts:        receipts || [],
    rate:            Number(recipient.reimbursement_rate),
    cap:             Number(recipient.approved_amount),
    paidToDate,
    committedToDate,
  });

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2rem", marginBottom: "0.5rem" }}>
        Hello, {recipient.applications.parent_names}
      </h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "2rem", lineHeight: 1.6 }}>
        Your approved grant is <strong>${Number(recipient.approved_amount).toFixed(2)}</strong> total.
        We reimburse <strong>{(Number(recipient.reimbursement_rate) * 100).toFixed(0)}%</strong> of approved receipts.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "1rem", marginBottom: "2.5rem" }}>
        <Card label="Approved cap"  value={`$${Number(recipient.approved_amount).toFixed(2)}`} />
        <Card label="Paid to date"  value={`$${paidToDate.toFixed(2)}`} />
        <Card label="Remaining"     value={`$${balance.remainingCap.toFixed(2)}`} />
        <Card label="Next payout"   value={`$${balance.eligibleForNextPayout.toFixed(2)}`} accent />
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "2.5rem", flexWrap: "wrap" }}>
        <Link href="/portal/receipts/new" className="tf-ok" style={{ textDecoration: "none" }}>+ Upload receipt</Link>
        <Link href="/portal/testimonials" className="tf-ok" style={{ textDecoration: "none", background: "white", color: "var(--text-primary)", border: "1.5px solid var(--text-primary)" }}>+ Add testimonial</Link>
      </div>

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", marginBottom: "0.75rem" }}>Your receipts</h2>
      {receipts && receipts.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "2rem" }}>
          {receipts.map((r: any) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", background: "rgba(255,255,255,0.75)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: "0.9rem", flexWrap: "wrap" }}>
              <span>{r.purchase_date || new Date(r.created_at).toLocaleDateString()} — {r.description || "Receipt"}</span>
              <span>
                <strong>${Number(r.amount).toFixed(2)}</strong>{" "}
                <em style={{ color: r.status === "approved" ? "var(--success)" : r.status === "rejected" ? "var(--danger)" : "var(--text-muted)", fontStyle: "normal", textTransform: "uppercase", fontSize: "0.72rem", marginLeft: "0.5rem", letterSpacing: "0.05em" }}>
                  {r.status}
                </em>
              </span>
            </div>
          ))}
        </div>
      ) : <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>No receipts uploaded yet.</p>}

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", marginBottom: "0.75rem" }}>Payout history</h2>
      {paid && paid.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {paid.map((p: any, i: number) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.75)", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10, padding: "0.75rem 1rem", fontSize: "0.9rem" }}>
              <span>{p.paid_at ? new Date(p.paid_at).toLocaleDateString() : "—"}</span>
              <span><strong>${Number(p.amount).toFixed(2)}</strong></span>
            </div>
          ))}
        </div>
      ) : <p style={{ color: "var(--text-muted)" }}>No payouts yet.</p>}
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.85)",
      border: `1.5px solid ${accent ? "var(--accent)" : "rgba(0,0,0,0.08)"}`,
      borderRadius: "var(--radius-lg)",
      padding: "1.25rem 1.25rem",
      boxShadow: "var(--shadow-card)",
    }}>
      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.08em", marginBottom: "0.35rem", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.8rem", fontFamily: "var(--font-display)", fontWeight: 500, color: accent ? "var(--accent)" : "inherit", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

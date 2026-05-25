import Link from "next/link";
import { supabaseServer, supabaseService } from "@/app/lib/supabase/server";
import { calcBalance } from "@/app/lib/grant-calc";
import { HelpHint } from "@/app/_components/HelpHint";
import { getEffectiveRecipient } from "@/app/lib/impersonation";

export const dynamic = "force-dynamic";

export default async function PortalDashboard() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Use the impersonation-aware helper so admins viewing "as test grantee"
  // see the seeded test recipient instead of their own profile's recipient.
  const ctx = await getEffectiveRecipient(user.id);
  const recipient = ctx.recipient;
  // Subsequent queries (receipts, payouts) need to run with service role
  // when impersonating, because the row isn't owned by the calling user
  // via profile_id (RLS would block reads otherwise).
  const dataClient = ctx.mode === "impersonating" ? supabaseService() : supabase;

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
    dataClient.from("receipts").select("*").eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
    dataClient.from("payouts").select("amount, paid_at, status").eq("recipient_id", recipient.id).order("created_at", { ascending: false }),
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

  // Submission deadline state
  const deadline = recipient.submission_deadline ? new Date(recipient.submission_deadline) : null;
  const now = new Date();
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000) : null;
  const deadlinePassed = deadline ? deadline < now : false;

  // Mobile gradient-hero progress %: how much of the cap has been used (paid + scheduled/approved)
  const approvedAmt = Number(recipient.approved_amount);
  const usedPct = approvedAmt > 0
    ? Math.min(100, Math.round((committedToDate / approvedAmt) * 100))
    : 0;

  // applications join may be null on orphan recipient rows — guard the deref.
  const parentNames = recipient.applications?.parent_names ?? "Family";
  const firstName   = parentNames.split(/[&,]| and /i)[0].trim().split(" ")[0];
  const recent      = (receipts || []).slice(0, 5);

  return (
    <div>
      {/* ════════════ MOBILE-ONLY HERO + FAB + RECENT (≤768px) ════════════ */}
      <div className="ra-portal-mobile-only">
        <h1 className="ra-portal-hello">Hi, {firstName} 👋</h1>
        <p className="ra-portal-hello-sub">
          {deadlinePassed
            ? "Your receipt window has closed."
            : daysLeft != null && daysLeft >= 0
              ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left to submit receipts.`
              : "Welcome to your portal."}
        </p>

        {/* Gradient grant card */}
        <div className="ra-grant-hero">
          <div className="ra-grant-label">Your grant</div>
          <div className="ra-grant-big">${paidToDate.toFixed(2)}</div>
          <div className="ra-grant-of">of ${approvedAmt.toFixed(2)} paid out</div>
          <div className="ra-grant-bar"><div className="ra-grant-fill" style={{ width: `${usedPct}%` }} /></div>
          <div className="ra-grant-meta">
            <span>${balance.remainingCap.toFixed(2)} remaining</span>
            {deadline && !deadlinePassed && daysLeft != null && daysLeft >= 0 && (
              <span>{daysLeft} day{daysLeft === 1 ? "" : "s"} left</span>
            )}
          </div>
        </div>

        {/* Next payout teaser, if any */}
        {balance.eligibleForNextPayout > 0 && (
          <div style={{
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 12,
            padding: "0.8rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.9rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <span style={{ color: "var(--text-secondary)" }}>Next payout</span>
            <strong style={{ color: "var(--accent-dark)", fontSize: "1.05rem" }}>${balance.eligibleForNextPayout.toFixed(2)}</strong>
          </div>
        )}

        {/* FAB upload card */}
        <Link href="/portal/receipts/new" className="ra-fab-card">
          <span className="ra-fab-card-ic">+</span>
          <span>
            <div className="ra-fab-card-title">Upload a receipt</div>
            <div className="ra-fab-card-sub">Snap with camera or pick from photos</div>
          </span>
        </Link>

        {/* Recent receipts as cards */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.2rem 0.6rem" }}>
          <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", fontWeight: 500, margin: 0 }}>Recent receipts</h3>
          {(receipts || []).length > recent.length && (
            <Link href="/portal/statement" style={{ color: "var(--accent-dark)", fontSize: "0.82rem", fontWeight: 600, textDecoration: "none" }}>See all →</Link>
          )}
        </div>
        {recent.length === 0 ? (
          <div style={{
            background: "#fff", border: "1px dashed rgba(0,0,0,0.12)",
            borderRadius: 12, padding: "1.5rem 1rem", textAlign: "center",
            color: "var(--text-muted)", fontSize: "0.9rem",
          }}>
            No receipts uploaded yet. Tap the orange card above to add your first.
          </div>
        ) : (
          <div className="ra-card-list">
            {recent.map((r: any) => {
              const pillCls =
                r.status === "approved" ? "ra-pill-approved" :
                r.status === "paid"     ? "ra-pill-paid"     :
                r.status === "scheduled"? "ra-pill-scheduled":
                r.status === "rejected" ? "ra-pill-rejected" :
                r.status === "cancelled"? "ra-pill-cancelled":
                                          "ra-pill-pending";
              const dateLabel = r.purchase_date
                ? new Date(r.purchase_date).toLocaleDateString("en-CA", { month: "short", day: "numeric" })
                : new Date(r.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
              return (
                <div key={r.id} className="ra-rc-row">
                  <span className="ra-rc-thumb">📕</span>
                  <span className="ra-rc-main">
                    <span className="ra-rc-name">{r.description || "Receipt"}</span>
                    <span className="ra-rc-meta">
                      <span className={`ra-pill-status ${pillCls}`}>{r.status}</span>
                      <span>· {dateLabel}</span>
                    </span>
                  </span>
                  <span className="ra-rc-amt">${Number(r.amount).toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ════════════ DESKTOP LAYOUT (hidden on mobile via CSS) ════════════ */}
      <div className="ra-portal-stat-grid-desktop">
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "2rem", marginBottom: "0.5rem" }}>
        Hello, {parentNames}
      </h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "1.25rem", lineHeight: 1.6 }}>
        Your approved grant is <strong>${Number(recipient.approved_amount).toFixed(2)}</strong> total.
        We reimburse <strong>{(Number(recipient.reimbursement_rate) * 100).toFixed(0)}%</strong> of approved receipts.
      </p>

      {deadline && (
        <div style={{
          background: deadlinePassed ? "rgba(224,80,80,0.08)" : daysLeft! <= 30 ? "rgba(232,121,58,0.08)" : "rgba(58,158,110,0.06)",
          border:     `1px solid ${deadlinePassed ? "rgba(224,80,80,0.3)" : daysLeft! <= 30 ? "rgba(232,121,58,0.3)" : "rgba(58,158,110,0.25)"}`,
          color:      deadlinePassed ? "var(--danger)" : "var(--text-primary)",
          borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.5rem", fontSize: "0.9rem", lineHeight: 1.55,
        }}>
          {deadlinePassed ? (
            <>Your receipt submission window <strong>closed on {deadline.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}</strong>. Contact <a href="mailto:register@raisingarrowsathome.com" style={{ color: "inherit", textDecoration: "underline" }}>register@raisingarrowsathome.com</a> if you believe this is an error.</>
          ) : (
            <>
              <strong>Submission deadline:</strong> {deadline.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}
              {daysLeft != null && daysLeft >= 0 && <> · {daysLeft} day{daysLeft === 1 ? "" : "s"} remaining</>}
            </>
          )}
        </div>
      )}

      <div style={{
        background: "rgba(255,255,255,0.7)", border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.75rem",
        fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.55,
      }}>
        <strong style={{ color: "var(--text-primary)" }}>Payment schedule:</strong> Payouts run on the 15th and the last day of each month. Submit receipts at least 2 weeks before either date to make that payout.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "1rem", marginBottom: "2.5rem" }}>
        <Card label="Approved cap" value={`$${Number(recipient.approved_amount).toFixed(2)}`}
              help={{ body: "The maximum total reimbursement you can receive from this grant over its lifetime.", examples: ["A $750 cap means we'll send you up to $750 total — split across however many payouts it takes."] }} />
        <Card label="Paid to date" value={`$${paidToDate.toFixed(2)}`}
              help={{ body: "How much we've actually sent you via e-transfer so far.", examples: ["If you've received one $440 e-transfer, this shows $440.00."] }} />
        <Card label="Remaining" value={`$${balance.remainingCap.toFixed(2)}`}
              help={{ body: "Your cap minus everything that's been paid or is queued to be paid. Once this hits $0 the grant is fully used.", examples: ["$875 cap − $440 paid = $435 remaining."] }} />
        <Card label="Next payout" value={`$${balance.eligibleForNextPayout.toFixed(2)}`} accent
              help={{ body: "What you'll receive on the next 15th or end-of-month payout — assuming all your currently-approved receipts go through.", examples: ["$200 of receipts approved at 75% rate → $150 next payout.", "If this shows $0, either no receipts are approved yet or you've already used the full cap."] }} />
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "2.5rem", flexWrap: "wrap" }}>
        <Link href="/portal/receipts/new" className="tf-ok" style={{ textDecoration: "none" }}>+ Upload receipt</Link>
        <Link href="/portal/testimonials" className="tf-ok" style={{ textDecoration: "none", background: "white", color: "var(--text-primary)", border: "1.5px solid var(--text-primary)" }}>+ Add testimonial</Link>
      </div>

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem", marginBottom: "0.75rem" }}>Your receipts</h2>
      {receipts && receipts.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "2rem" }}>
          {receipts.map((r: any) => {
            const isRejected = r.status === "rejected";
            const reUploadHref = `/portal/receipts/new?replacing=${encodeURIComponent(r.id)}` +
              `&amount=${encodeURIComponent(Number(r.amount).toString())}` +
              `&currency=${encodeURIComponent(r.currency || "CAD")}` +
              (r.purchase_date ? `&date=${encodeURIComponent(r.purchase_date)}` : "") +
              (r.description   ? `&description=${encodeURIComponent(r.description)}` : "");
            return (
              <div key={r.id} style={{
                background: isRejected ? "rgba(208,74,74,0.04)" : "rgba(255,255,255,0.75)",
                border:     `1px solid ${isRejected ? "rgba(208,74,74,0.25)" : "rgba(0,0,0,0.08)"}`,
                borderRadius: 10, padding: "0.75rem 1rem", fontSize: "0.9rem",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <span>{r.purchase_date || new Date(r.created_at).toLocaleDateString()} — {r.description || "Receipt"}</span>
                  <span>
                    <strong>${Number(r.amount).toFixed(2)}</strong>{" "}
                    <em style={{ color: r.status === "approved" ? "var(--success)" : isRejected ? "var(--danger)" : "var(--text-muted)", fontStyle: "normal", textTransform: "uppercase", fontSize: "0.72rem", marginLeft: "0.5rem", letterSpacing: "0.05em" }}>
                      {r.status}
                    </em>
                  </span>
                </div>
                {isRejected && (
                  <div style={{ marginTop: "0.55rem", fontSize: "0.82rem", lineHeight: 1.5, color: "var(--text-secondary)" }}>
                    {r.admin_notes && (
                      <div style={{ background: "rgba(255,255,255,0.7)", padding: "0.45rem 0.7rem", borderRadius: 8, marginBottom: "0.45rem", whiteSpace: "pre-wrap" }}>
                        <strong style={{ color: "var(--danger)" }}>Reason:</strong> {r.admin_notes}
                      </div>
                    )}
                    <Link href={reUploadHref}
                      style={{ color: "var(--accent)", fontWeight: 500, textDecoration: "none", borderBottom: "1px solid currentColor" }}>
                      ↻ Upload corrected version
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
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
      </div>{/* /.ra-portal-stat-grid-desktop */}
    </div>
  );
}

function Card({ label, value, accent, help }: { label: string; value: string; accent?: boolean; help?: { body: string; examples?: string[] } }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.85)",
      border: `1.5px solid ${accent ? "var(--accent)" : "rgba(0,0,0,0.08)"}`,
      borderRadius: "var(--radius-lg)",
      padding: "1.25rem 1.25rem",
      boxShadow: "var(--shadow-card)",
    }}>
      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.08em", marginBottom: "0.35rem", fontWeight: 600, display: "flex", alignItems: "center" }}>
        {label}
        {help && <HelpHint body={help.body} examples={help.examples} />}
      </div>
      <div style={{ fontSize: "1.8rem", fontFamily: "var(--font-display)", fontWeight: 500, color: accent ? "var(--accent)" : "inherit", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}
